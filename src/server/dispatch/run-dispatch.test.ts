import { describe, expect, it, vi } from "vitest";
import type { GmailSendResult } from "@/server/gmail/gmail-client";
import type { RefreshResult } from "@/server/google/gmail-oauth";
import type {
  Claim,
  DispatchStore,
  ReserveResult,
} from "@/server/queries/dispatch";
import * as icsModule from "@/lib/calendar/ics";
import { runDispatch, type DispatchDeps } from "./run-dispatch";

const OPTIONS = {
  budgetMs: 50_000,
  paceMs: 1_000,
  batchSize: 50,
  leaseSeconds: 70,
};

function job(
  n: number,
  meetingId = "11111111-1111-4111-8111-111111111111",
  threadId: string | null = null,
) {
  return {
    jobId: `00000000-0000-4000-8000-00000000000${n}`,
    kind: "invite" as "invite" | "calendar_confirm",
    attempts: 1,
    inviteeId: `10000000-0000-4000-8000-00000000000${n}`,
    workspaceId: "20000000-0000-4000-8000-000000000000",
    workspaceName: "GDG ISSAT",
    contact: { fullName: `Member ${n}`, email: `m${n}@uni.tn` },
    meeting: {
      id: meetingId,
      title: "Weekly sync",
      agendaMd: "",
      startsAt: "2026-10-09T17:00:00.000Z",
      durationMinutes: 60,
      timezone: "Africa/Tunis",
      locationMode: "in_person" as const,
      locationText: "Room B12",
      onlineText: "",
      meetingUrl: "",
      responseMode: "attendance" as const,
      responseDeadline: null,
      icsUid: "meeting-1@tapnshow.vercel.app",
      threadId,
      rootMessageId: threadId ? "<root@tapnshow.vercel.app>" : null,
    },
  };
}

/** A calendar_confirm job for the same meeting (thread already started by the invites). */
function calendarJob(n: number) {
  return { ...job(n, undefined, "t-1"), kind: "calendar_confirm" as const };
}

const decoded = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

function setup(options: {
  jobs: ReturnType<typeof job>[];
  gmail?: GmailSendResult[];
  refresh?: RefreshResult[];
  reserve?: ReserveResult[];
}) {
  const claim: Claim = {
    connection: {
      id: "30000000-0000-4000-8000-000000000000",
      userId: "40000000-0000-4000-8000-000000000000",
      googleSub: "g-1",
      googleEmail: "club@gmail.com",
      refreshTokenEncrypted: "sealed",
    },
    jobs: options.jobs,
  };
  let claimed = false;
  const reserves = [...(options.reserve ?? [])];
  const store = {
    claim: vi.fn(async () => {
      if (claimed) {
        return null;
      }
      claimed = true;
      return claim;
    }),
    reserve: vi.fn(
      async (): Promise<ReserveResult> =>
        reserves.shift() ?? { kind: "ok", calendar: null },
    ),
    finish: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    unclaim: vi.fn(async () => undefined),
    deferSender: vi.fn(async () => undefined),
    markBroken: vi.fn(async () => ({
      newlyBroken: true,
      alert: [
        {
          email: "owner@x.test",
          workspaceName: "GDG ISSAT",
          workspaceSlug: "gdg-ab12",
        },
      ],
    })),
    setThread: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  } satisfies DispatchStore;
  const sends = [...(options.gmail ?? [])];
  const refreshes = [...(options.refresh ?? [])];
  let clock = 0;
  const deps: DispatchDeps = {
    store,
    gmail: vi.fn<DispatchDeps["gmail"]>(
      async () => sends.shift() ?? { kind: "sent", id: "m", threadId: "t-new" },
    ),
    refresh: vi.fn<DispatchDeps["refresh"]>(
      async () => refreshes.shift() ?? { kind: "ok", accessToken: "at" },
    ),
    openToken: vi.fn<DispatchDeps["openToken"]>(() => "1//refresh"),
    tokenFor: (inviteeId: string) => `token-${inviteeId}`,
    appUrl: "https://tapnshow.vercel.app",
    now: () => clock,
    sleep: vi.fn<DispatchDeps["sleep"]>(async (ms) => {
      clock += ms;
    }),
    alertBroken: vi.fn<DispatchDeps["alertBroken"]>(async () => undefined),
    newRunId: () => "50000000-0000-4000-8000-000000000000",
  };
  return { deps, store, advance: (ms: number) => (clock += ms) };
}

describe("runDispatch", () => {
  it("sends the root email without a thread, threads the rest, paces, records token hashes", async () => {
    const { deps, store } = setup({ jobs: [job(1), job(2)] });
    const summary = await runDispatch(deps, OPTIONS);
    expect(summary).toMatchObject({ sent: 2, senders: 1 });
    const gmail = vi.mocked(deps.gmail).mock.calls;
    expect(gmail[0][0].threadId).toBeNull();
    expect(gmail[1][0].threadId).toBe("t-new");
    const secondRaw = Buffer.from(gmail[1][0].raw, "base64url").toString(
      "utf8",
    );
    expect(secondRaw).toMatch(
      /In-Reply-To: <[0-9a-f-]+@tapnshow\.vercel\.app>/,
    );
    expect(store.setThread).toHaveBeenCalledTimes(1);
    expect(store.finish).toHaveBeenCalledWith(
      job(1).jobId,
      "sent",
      null,
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
    expect(deps.sleep).toHaveBeenCalledWith(1_000);
    expect(store.release).toHaveBeenCalledWith(
      "50000000-0000-4000-8000-000000000000",
    );
  });

  it("joins an existing thread on this connection", async () => {
    const { deps, store } = setup({ jobs: [job(1, undefined, "t-old")] });
    await runDispatch(deps, OPTIONS);
    expect(vi.mocked(deps.gmail).mock.calls[0][0].threadId).toBe("t-old");
    expect(store.setThread).not.toHaveBeenCalled();
  });

  it("starts a new root when Gmail no longer knows the thread", async () => {
    const { deps, store } = setup({
      jobs: [job(1, undefined, "t-gone")],
      gmail: [{ kind: "thread_missing" }],
    });
    await runDispatch(deps, OPTIONS);
    const calls = vi.mocked(deps.gmail).mock.calls;
    expect(calls[1][0].threadId).toBeNull();
    expect(store.setThread).toHaveBeenCalledTimes(1);
  });

  it("refreshes once on 401", async () => {
    const { deps, store } = setup({
      jobs: [job(1)],
      gmail: [{ kind: "auth" }],
    });
    await runDispatch(deps, OPTIONS);
    expect(deps.refresh).toHaveBeenCalledTimes(2);
    expect(store.finish).toHaveBeenCalledWith(
      job(1).jobId,
      "sent",
      null,
      expect.any(String),
    );
  });

  it("marks the sender broken on invalid_grant and alerts the Owner", async () => {
    const { deps, store } = setup({
      jobs: [job(1), job(2)],
      refresh: [{ kind: "invalid_grant" }],
    });
    await runDispatch(deps, OPTIONS);
    expect(deps.gmail).not.toHaveBeenCalled();
    expect(store.markBroken).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "invalid_grant",
    );
    expect(deps.alertBroken).toHaveBeenCalledWith([
      {
        email: "owner@x.test",
        workspaceName: "GDG ISSAT",
        workspaceSlug: "gdg-ab12",
      },
    ]);
  });

  it("defers the whole sender when Gmail throttles, and stops", async () => {
    const { deps, store } = setup({
      jobs: [job(1), job(2)],
      gmail: [{ kind: "throttled" }],
    });
    await runDispatch(deps, OPTIONS);
    expect(store.deferSender).toHaveBeenCalledTimes(1);
    expect(deps.gmail).toHaveBeenCalledTimes(1);
  });

  it("retries 5xx, fails refused recipients, and never retries an unknown outcome", async () => {
    const { deps, store } = setup({
      jobs: [job(1), job(2), job(3)],
      gmail: [
        { kind: "retry", status: 503 },
        { kind: "invalid_recipient", reason: "Invalid To header" },
        { kind: "unknown", reason: "TimeoutError" },
      ],
    });
    const summary = await runDispatch(deps, OPTIONS);
    expect(store.retry).toHaveBeenCalledWith(job(1).jobId, "http_503");
    expect(store.finish).toHaveBeenCalledWith(
      job(2).jobId,
      "failed",
      "Invalid To header",
      null,
    );
    expect(store.finish).toHaveBeenCalledWith(
      job(3).jobId,
      "unknown",
      "delivery_unknown",
      null,
    );
    expect(summary).toMatchObject({ sent: 0, failed: 1, unknown: 1 });
    // The hash is stored when the send starts, so even an "unknown" email has working links.
    expect(store.reserve).toHaveBeenCalledWith(
      job(3).jobId,
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
  });

  it("on the daily cap, defers all of that sender's jobs once and does not re-claim it (#168)", async () => {
    const quota = setup({ jobs: [job(1), job(2), job(3)] });
    // Like the database: the sender stays claimable until its jobs are pushed back.
    let deferred = false;
    let claims = 0;
    quota.store.claim.mockImplementation(async () => {
      claims += 1;
      quota.advance(1_000);
      return deferred || claims > 20
        ? null
        : {
            connection: {
              id: "30000000-0000-4000-8000-000000000000",
              userId: "40000000-0000-4000-8000-000000000000",
              googleSub: "g-1",
              googleEmail: "club@gmail.com",
              refreshTokenEncrypted: "sealed",
            },
            jobs: [job(1), job(2), job(3)],
          };
    });
    quota.store.deferSender.mockImplementation(async () => {
      deferred = true;
    });
    quota.store.reserve.mockImplementation(async () => ({
      kind: "quota",
      retryAt: "2026-10-10T17:00:00.000Z",
    }));
    const summary = await runDispatch(quota.deps, OPTIONS);
    expect(quota.store.deferSender).toHaveBeenCalledOnce();
    expect(quota.store.deferSender).toHaveBeenCalledWith(
      "50000000-0000-4000-8000-000000000000",
      "30000000-0000-4000-8000-000000000000",
      new Date("2026-10-10T17:00:00.000Z"),
      "quota",
    );
    expect(quota.store.reserve).toHaveBeenCalledOnce();
    expect(quota.deps.refresh).toHaveBeenCalledOnce();
    expect(quota.deps.gmail).not.toHaveBeenCalled();
    expect(summary.deferred).toBe(1);
  });

  it("stops a sender at the time budget, handing jobs back", async () => {
    const budget = setup({ jobs: [job(1), job(2), job(3)] });
    await runDispatch(budget.deps, { ...OPTIONS, budgetMs: 1_500 });
    expect(budget.store.unclaim).toHaveBeenCalledWith([job(3).jobId]);
  });

  it("sends a pre-accepted calendar invitation for a calendar job, in the meeting's thread", async () => {
    const { deps, store } = setup({
      jobs: [calendarJob(1)],
      reserve: [{ kind: "ok", calendar: { action: "request", sequence: 0 } }],
    });
    const summary = await runDispatch(deps, OPTIONS);
    const sent = vi.mocked(deps.gmail).mock.calls[0][0];
    expect(sent.threadId).toBe("t-1");
    const mime = decoded(sent.raw);
    expect(mime).toMatch(/method=REQUEST/i);
    // The subject is RFC 2047-encoded (it contains "·").
    expect(mime).toMatch(
      /Subject: =\?UTF-8\?Q\?In_your_calendar=3A_Weekly_sync/,
    );
    expect(store.finish).toHaveBeenCalledWith(
      calendarJob(1).jobId,
      "sent",
      null,
      expect.any(String),
    );
    expect(summary).toMatchObject({ sent: 1, calendar: 1 });
  });

  it("builds the event from the meeting, with the given sequence, and no personal link", async () => {
    const spy = vi.spyOn(icsModule, "buildMeetingIcs");
    const { deps } = setup({
      jobs: [calendarJob(1)],
      reserve: [{ kind: "ok", calendar: { action: "cancel", sequence: 3 } }],
    });
    await runDispatch(deps, OPTIONS);
    const ics = String(spy.mock.results[0]?.value);
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("SEQUENCE:3");
    expect(ics).toContain("UID:meeting-1@tapnshow.vercel.app");
    expect(ics).not.toContain("/r/");
    expect(ics).not.toContain(deps.tokenFor(calendarJob(1).inviteeId));
    expect(decoded(vi.mocked(deps.gmail).mock.calls[0][0].raw)).toMatch(
      /method=CANCEL/i,
    );
    spy.mockRestore();
  });

  it("sends nothing when the reservation says there is nothing to do (quick flips)", async () => {
    const { deps } = setup({
      jobs: [calendarJob(1)],
      reserve: [{ kind: "done" }],
    });
    await runDispatch(deps, OPTIONS);
    expect(deps.gmail).not.toHaveBeenCalled();
  });

  it("fails a calendar job that came back without a decision instead of guessing", async () => {
    const { deps, store } = setup({ jobs: [calendarJob(1)] });
    await runDispatch(deps, OPTIONS);
    expect(deps.gmail).not.toHaveBeenCalled();
    expect(store.finish).toHaveBeenCalledWith(
      calendarJob(1).jobId,
      "failed",
      "no_calendar_decision",
      null,
    );
  });
});
