import "server-only";
import { resolveLocale } from "@/config/i18n";
import { logger } from "@/lib/logger";
import {
  pushMessage,
  pushTtlSeconds,
  pushUrgency,
  pushWords,
  type PushWords,
} from "@/lib/push/message";
import type { PushStore } from "@/server/queries/push";
import type { PushItem } from "@/shared/api/push";
import { classifyPushResult } from "./classify";
import { type PushSend, pushTopic } from "./send";

/** What the push lane needs from the outside world (injected, so tests use fakes). */
export type PushDeps = {
  store: PushStore;
  send: PushSend;
  reportBug: (status: number) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  newRunId: () => string;
};

/** One run's limits (`WORKER_OPTIONS.push` in production). */
export type PushOptions = {
  budgetMs: number;
  minLeftMs: number;
  concurrency: number;
  leaseSeconds: number;
  idlePollMs: number;
};

/** What a run did (logged as counts only). */
export type PushSummary = {
  sent: number;
  gone: number;
  retried: number;
  dropped: number;
  stale: number;
};

/**
 * Drains due phone notifications (spec §8 Push worker): claims a batch, sends it side by side,
 * and records each result. While the email worker still runs (`emails.running()`), an empty claim
 * waits and looks again, so a push follows its email within seconds.
 */
export async function runPush(
  deps: PushDeps,
  options: PushOptions,
  emails: { running: () => boolean } = { running: () => false },
): Promise<PushSummary> {
  const started = deps.now();
  const run = deps.newRunId();
  const summary: PushSummary = {
    sent: 0,
    gone: 0,
    retried: 0,
    dropped: 0,
    stale: 0,
  };
  const words = new Map<string, PushWords>();
  const wordsFor = (locale: string) => {
    const resolved = resolveLocale(locale);
    const cached = words.get(resolved) ?? pushWords(resolved);
    words.set(resolved, cached);
    return cached;
  };
  const deliver = async (item: PushItem) => {
    const message = pushMessage(item, wordsFor(item.locale));
    const result = await deps.send(
      { endpoint: item.endpoint, p256dh: item.p256dh, auth: item.auth },
      JSON.stringify(message),
      {
        ttl: pushTtlSeconds(item, deps.now()),
        urgency: pushUrgency(item),
        topic: pushTopic(message.tag),
      },
    );
    const outcome = classifyPushResult(result, item.attempts);
    if (outcome.kind === "sent") {
      await deps.store.done(item.id, run);
      summary.sent += 1;
    } else if (outcome.kind === "gone") {
      await deps.store.gone(item.id, run);
      summary.gone += 1;
    } else if (outcome.kind === "retry") {
      await deps.store.retry(item.id, run, outcome.afterSeconds);
      summary.retried += 1;
    } else {
      deps.reportBug(result.status ?? 0);
      await deps.store.drop(item.id, run);
      summary.dropped += 1;
    }
  };
  while (options.budgetMs - (deps.now() - started) >= options.minLeftMs) {
    const claim = await deps.store.claim(
      run,
      options.concurrency,
      options.leaseSeconds,
    );
    summary.stale += claim.dropped;
    if (claim.items.length === 0) {
      if (!emails.running()) {
        break;
      }
      await deps.sleep(options.idlePollMs);
      continue;
    }
    await Promise.all(claim.items.map(deliver));
  }
  if (
    summary.sent +
      summary.gone +
      summary.retried +
      summary.dropped +
      summary.stale >
    0
  ) {
    logger.info(summary, "push run");
  }
  return summary;
}
