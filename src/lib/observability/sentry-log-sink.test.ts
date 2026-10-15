import { describe, expect, it, vi } from "vitest";

const { logger } = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));
vi.mock("@sentry/nextjs", () => ({ logger }));

import {
  SENTRY_LOG_MIN_LEVEL,
  sentryLogSink,
  toSentryLog,
} from "./sentry-log-sink";

describe("toSentryLog", () => {
  it("maps pino levels and keeps flat attributes (objects as JSON)", () => {
    expect(
      toSentryLog({
        level: 50,
        time: 1,
        app: "TapNShow",
        msg: "dispatch run finished",
        summary: { sent: 2 },
        jobId: "j1",
      }),
    ).toEqual({
      level: "error",
      message: "dispatch run finished",
      attributes: { app: "TapNShow", summary: '{"sent":2}', jobId: "j1" },
    });
  });

  it("sends info and above only (spec §5: info+)", () => {
    expect(SENTRY_LOG_MIN_LEVEL).toBe(30);
    expect(toSentryLog({ level: 30, msg: "kept" })?.level).toBe("info");
    expect(toSentryLog({ level: 20, msg: "debug line" })).toBeNull();
  });
});

describe("sentryLogSink", () => {
  it("never throws into the logger", () => {
    logger.warn.mockImplementationOnce(() => {
      throw new Error("sdk down");
    });
    expect(() => sentryLogSink({ level: 40, msg: "careful" })).not.toThrow();
  });
});
