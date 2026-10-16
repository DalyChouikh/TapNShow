import "server-only";
import { type DiscordMessage, discordMessage } from "@/lib/discord/embed";
import {
  type PlatformEvent,
  type PlatformEventKind,
  platformEventMessage,
} from "@/lib/discord/platform-events";
import { logger } from "@/lib/logger";
import type { OwnerAlertInput } from "@/server/email/owner-alert";
import type { PlatformStore } from "@/server/queries/platform";

/** What the lane needs (real ones in platform-deps.ts; fakes in tests). */
export type PlatformDeps = {
  appUrl: string;
  /** `DISCORD_PLATFORM_WEBHOOK`; unset (local, CI, previews) marks events done without posting. */
  webhook: string | undefined;
  now: () => number;
  store: PlatformStore;
  post: (
    webhook: string,
    message: DiscordMessage,
  ) => Promise<{ ok: boolean; status: number }>;
  alertOwner: (to: string, alert: OwnerAlertInput) => Promise<void>;
};

/** The kinds that also email the workspace's Owner, and which email. */
const OWNER_ALERTS: Partial<
  Record<PlatformEventKind, "sendingSuspended" | "sendingResumed">
> = {
  auto_suspended: "sendingSuspended",
  suspended: "sendingSuspended",
  lifted: "sendingResumed",
};

/**
 * Emails the Owner about a suspension or a lift, at most once per event: the target is spent (and
 * `emailed_at` stamped) before sending, so a retried post never sends a second email. Over the
 * platform's daily cap there is no target and the email is skipped. Returns whether it was sent.
 */
async function emailOwner(
  deps: PlatformDeps,
  event: PlatformEvent,
): Promise<boolean> {
  const kind = OWNER_ALERTS[event.kind];
  if (!kind || event.emailedAt) {
    return false;
  }
  const target = await deps.store.ownerTarget(event.id);
  if (!target) {
    logger.info({ eventId: event.id }, "platform owner email skipped");
    return false;
  }
  try {
    await deps.alertOwner(target.email, {
      kind,
      workspaceName: target.workspaceName,
      workspaceSlug: target.workspaceSlug,
    });
    return true;
  } catch (error) {
    logger.error(
      { err: error, eventId: event.id },
      "platform owner email failed",
    );
    return false;
  }
}

/** Posts one event; a network error counts as a failed post like an HTTP refusal. */
async function post(
  deps: PlatformDeps,
  webhook: string,
  event: PlatformEvent,
): Promise<{ ok: boolean; status: number }> {
  try {
    return await deps.post(
      webhook,
      discordMessage(platformEventMessage(event, deps.appUrl)),
    );
  } catch (error) {
    logger.warn({ err: error, eventId: event.id }, "platform event post threw");
    return { ok: false, status: 0 };
  }
}

/**
 * Drains platform_events (spec §8 M9): each event posts one #platform embed and, for a suspension
 * or a lift, emails the workspace's Owner once. A failed post is retried by later runs (backing
 * off, then given up at `platform_notify_attempts_max`); the action itself has already committed.
 */
export async function runPlatformEvents(
  deps: PlatformDeps,
  options: { budgetMs: number; batchSize: number; leaseSeconds: number },
): Promise<{ posted: number; emailed: number; failed: number }> {
  const started = deps.now();
  const summary = { posted: 0, emailed: 0, failed: 0 };
  while (deps.now() - started < options.budgetMs) {
    const events = await deps.store.claim(
      options.batchSize,
      options.leaseSeconds,
    );
    if (events.length === 0) {
      break;
    }
    for (const event of events) {
      if (await emailOwner(deps, event)) {
        summary.emailed += 1;
      }
      if (!deps.webhook) {
        await deps.store.done(event.id);
        continue;
      }
      const result = await post(deps, deps.webhook, event);
      if (result.ok) {
        summary.posted += 1;
        await deps.store.done(event.id);
      } else {
        summary.failed += 1;
        const attempts = await deps.store.failed(event.id);
        logger.warn(
          { eventId: event.id, status: result.status, attempts },
          "platform event post failed",
        );
      }
    }
  }
  logger.info({ summary }, "platform events run finished");
  return summary;
}
