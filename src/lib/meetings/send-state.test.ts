import { addHours, addMinutes } from "date-fns";
import { describe, expect, it } from "vitest";
import { PROGRESS_POLL_MS, THROTTLE_DEFER_MS } from "@/config/meetings";
import { RESULTS_POLL_MS } from "@/config/responses";
import type { MeetingResults } from "@/shared/api/responses";
import { resultsFixture } from "@/test/fixtures/meetings";
import { resultsPollMs, sendState } from "./send-state";

const results = (over: Partial<MeetingResults>): MeetingResults => ({
  ...resultsFixture,
  ...over,
});
const emails = (queued: number) => ({
  total: 30,
  queued,
  sent: 30 - queued,
  skipped: 0,
  failed: 0,
  unknown: 0,
});

describe("sendState (#417)", () => {
  it.each([
    [
      "paused for review while emails wait",
      results({ emails: emails(5) }),
      true,
      { kind: "paused", why: "suspended" },
    ],
    [
      "Gmail broken",
      results({ emails: emails(5), senderState: "broken" }),
      false,
      { kind: "paused", why: "broken" },
    ],
    [
      "Gmail missing",
      results({ emails: emails(5), senderState: "missing" }),
      false,
      { kind: "paused", why: "missing" },
    ],
    [
      "held jobs",
      results({ emails: emails(0), paused: 3 }),
      false,
      { kind: "paused", why: "missing" },
    ],
    [
      "waiting for Gmail's limit",
      results({ emails: emails(5), resumesAt: "2026-10-21T15:00:00.000Z" }),
      false,
      { kind: "waiting", resumesAt: "2026-10-21T15:00:00.000Z" },
    ],
    [
      "going out",
      results({ emails: emails(5), paused: 0, resumesAt: null }),
      false,
      { kind: "sending" },
    ],
    [
      "all sent (a pause for review no longer matters)",
      results({ emails: emails(0), paused: 0 }),
      true,
      { kind: "sent" },
    ],
  ] as const)("%s", (_name, given, suspended, expected) => {
    expect(sendState(given, suspended)).toEqual(expected);
  });
});

describe("resultsPollMs (#417)", () => {
  const now = new Date("2026-10-21T14:00:00.000Z");
  const waitingUntil = (resumesAt: Date) =>
    results({ emails: emails(5), resumesAt: resumesAt.toISOString() });
  const sent = results({ emails: emails(0) });

  it.each([
    [
      "while invites go out",
      results({ emails: emails(5) }),
      false,
      PROGRESS_POLL_MS,
    ],
    [
      "while live and invites go out",
      results({ emails: emails(5) }),
      true,
      PROGRESS_POLL_MS,
    ],
    [
      "paused, not live: never",
      results({ emails: emails(5), senderState: "broken" }),
      false,
      false,
    ],
    [
      "paused but live: the live pace",
      results({ emails: emails(5), paused: 5 }),
      true,
      RESULTS_POLL_MS,
    ],
    ["sent, not live: never", sent, false, false],
    ["sent and live", sent, true, RESULTS_POLL_MS],
    ["not loaded yet", undefined, false, false],
    [
      "waiting: at the resume time",
      waitingUntil(addMinutes(now, 20)),
      false,
      20 * 60_000,
    ],
    [
      "waiting but live: the sooner",
      waitingUntil(addMinutes(now, 20)),
      true,
      RESULTS_POLL_MS,
    ],
    [
      "waiting, resume time passed: soon",
      waitingUntil(addMinutes(now, -1)),
      false,
      PROGRESS_POLL_MS,
    ],
    [
      "waiting far ahead: an hour at most",
      waitingUntil(addHours(now, 30)),
      false,
      THROTTLE_DEFER_MS,
    ],
  ] as const)("%s", (_name, given, live, expected) => {
    expect(resultsPollMs(given, false, live, now)).toBe(expected);
  });

  it("doesn't poll while sending is paused for review", () => {
    expect(
      resultsPollMs(results({ emails: emails(5) }), true, false, now),
    ).toBe(false);
  });
});
