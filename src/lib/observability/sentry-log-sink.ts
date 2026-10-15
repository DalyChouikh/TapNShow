import * as Sentry from "@sentry/nextjs";
import type { Json } from "@/lib/json";

/** One finished, scrubbed log line (pino's JSON). */
export type LogRecord = {
  level: number;
  msg?: string;
  [key: string]: Json | undefined;
};

type SentryLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/** A log as Sentry Logs takes it. */
export type SentryLog = {
  level: SentryLevel;
  message: string;
  attributes: Record<string, string | number | boolean>;
};

/** Lowest pino level sent to Sentry Logs (30 = info; spec §5: info and above). */
export const SENTRY_LOG_MIN_LEVEL = 30;

const LEVELS: ReadonlyArray<[number, SentryLevel]> = [
  [60, "fatal"],
  [50, "error"],
  [40, "warn"],
  [30, "info"],
  [20, "debug"],
  [10, "trace"],
];

/** pino's bookkeeping fields, not attributes. */
const SKIPPED = new Set(["level", "time", "msg", "pid", "hostname"]);

/** A scrubbed pino line as a Sentry log, or null below the minimum level. */
export function toSentryLog(record: LogRecord): SentryLog | null {
  if (record.level < SENTRY_LOG_MIN_LEVEL) {
    return null;
  }
  const level = LEVELS.find(([value]) => record.level >= value)?.[1] ?? "info";
  const attributes: SentryLog["attributes"] = {};
  for (const [key, value] of Object.entries(record)) {
    if (SKIPPED.has(key) || value === undefined || value === null) {
      continue;
    }
    attributes[key] = typeof value === "object" ? JSON.stringify(value) : value;
  }
  return { level, message: record.msg ?? "", attributes };
}

/**
 * Sends one scrubbed line to Sentry Logs (free: 5 GB/month, 30-day lookback). Sentry links it to
 * the active trace itself. Never throws into the logger.
 */
export function sentryLogSink(record: LogRecord): void {
  try {
    const log = toSentryLog(record);
    if (log) {
      Sentry.logger[log.level](log.message, log.attributes);
    }
  } catch {
    // A failing SDK must not break logging; the line is already on stdout.
  }
}
