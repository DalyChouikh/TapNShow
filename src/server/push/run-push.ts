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
  /** Tells Sentry about a bug on our side (a request a push service refused, an unreadable row). */
  reportBug: (message: string) => void;
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
 * Drains due phone notifications (spec §8 Push worker) with up to `concurrency` sends in flight:
 * whenever one finishes, the free slots claim more, so one slow push service never holds up the
 * rest. Each result is recorded. While the email worker still runs (`emails.running()`), an empty
 * queue waits and looks again, so a push follows its email within seconds. No new claim starts
 * once less than `minLeftMs` of the budget is left; sends already in flight finish (each is
 * bounded by the request timeout).
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
    const outcome = classifyPushResult(result, item.attempts, deps.now());
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
      deps.reportBug(`Web Push ${result.status ?? 0}`);
      await deps.store.drop(item.id, run);
      summary.dropped += 1;
    }
  };
  const inFlight = new Set<Promise<void>>();
  const start = (item: PushItem) => {
    const sending: Promise<void> = deliver(item).finally(() =>
      inFlight.delete(sending),
    );
    inFlight.add(sending);
  };
  while (options.budgetMs - (deps.now() - started) >= options.minLeftMs) {
    const free = options.concurrency - inFlight.size;
    if (free === 0) {
      await Promise.race(inFlight);
      continue;
    }
    const claim = await deps.store.claim(run, free, options.leaseSeconds);
    summary.stale += claim.dropped;
    if (claim.unreadable > 0) {
      summary.dropped += claim.unreadable;
      deps.reportBug(`Unreadable push deliveries: ${claim.unreadable}`);
    }
    claim.items.forEach(start);
    if (claim.items.length + claim.unreadable >= free) {
      continue;
    }
    // The queue is empty for now: wait for a send to free a slot, or for the email worker.
    if (inFlight.size > 0) {
      await Promise.race(inFlight);
    } else if (emails.running()) {
      await deps.sleep(options.idlePollMs);
    } else {
      break;
    }
  }
  await Promise.all(inFlight);
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
