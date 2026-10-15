import { describe, expect, it, vi } from "vitest";
import type { PushStore } from "@/server/queries/push";
import type { PushItem } from "@/shared/api/push";
import type { PushSendResult } from "./classify";
import { type PushDeps, type PushOptions, runPush } from "./run-push";
import type { PushSend } from "./send";

const OPTIONS: PushOptions = {
  budgetMs: 50_000,
  minLeftMs: 12_000,
  concurrency: 3,
  leaseSeconds: 120,
  idlePollMs: 2_000,
};

let next = 0;
function item(over: Partial<PushItem> = {}): PushItem {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
    kind: "invite",
    audience: null,
    attempts: 1,
    inviteeId: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
    endpoint: `https://fcm.googleapis.com/fcm/send/${next}`,
    p256dh: "k",
    auth: "a",
    workspaceName: "GDG ISSAT",
    locale: "en",
    title: "Weekly sync",
    startsAt: "2026-10-18T17:00:00.000Z",
    timezone: "Africa/Tunis",
    durationMinutes: 60,
    locationMode: "in_person",
    locationText: "Room B12",
    onlineText: "",
    responseMode: "attendance",
    answered: false,
    needsReconfirmation: false,
    ...over,
  };
}

/**
 * A store that hands out the given batches, at most `limit` items per claim like `push_claim`
 * (the rest of a batch comes with the next claim), then empty claims.
 */
function fakeStore(batches: PushItem[][]) {
  const queue = batches.map((batch) => [...batch]);
  const store = {
    claim: vi.fn<PushStore["claim"]>(async (_run, limit) => {
      const items = queue[0]?.splice(0, limit) ?? [];
      if (queue[0]?.length === 0) {
        queue.shift();
      }
      return { dropped: 0, unreadable: 0, items };
    }),
    done: vi.fn<PushStore["done"]>(async () => true),
    retry: vi.fn<PushStore["retry"]>(async () => true),
    drop: vi.fn<PushStore["drop"]>(async () => undefined),
    gone: vi.fn<PushStore["gone"]>(async () => undefined),
  };
  return store;
}

function deps(
  store: ReturnType<typeof fakeStore>,
  send: PushSend,
  clock = { t: 0 },
) {
  const reportBug = vi.fn<(message: string) => void>();
  const sleep = vi.fn<(ms: number) => Promise<void>>(async (ms) => {
    clock.t += ms;
  });
  const value: PushDeps = {
    store,
    send,
    reportBug,
    now: () => clock.t,
    sleep,
    newRunId: () => "run-1",
  };
  return { value, reportBug, sleep, clock };
}

const answering =
  (byEndpoint: Record<string, PushSendResult> = {}): PushSend =>
  async (target) =>
    byEndpoint[target.endpoint] ?? { status: 201, retryAfter: null };

describe("runPush (spec §8 Push worker)", () => {
  it("sends every claimed delivery with its own words and records it", async () => {
    const batch = [item(), item({ kind: "cancel" })];
    const store = fakeStore([batch]);
    const sent: string[] = [];
    const { value } = deps(store, async (_target, payload, options) => {
      sent.push(
        `${JSON.parse(payload).body}|${options.ttl > 0}|${options.topic.length}`,
      );
      return { status: 201, retryAfter: null };
    });
    const summary = await runPush(value, OPTIONS);
    expect(summary).toMatchObject({ sent: 2, gone: 0, retried: 0, dropped: 0 });
    expect(store.done.mock.calls.map(([id, run]) => `${id}:${run}`)).toEqual(
      batch.map((row) => `${row.id}:run-1`),
    );
    expect(sent).toEqual([
      "New invite: Sun 18 Oct, 18:00. Are you coming?|true|32",
      "This meeting was cancelled.|true|32",
    ]);
  });

  it("removes a gone device, backs off a busy service, drops and reports a bad request", async () => {
    const [gone, busy, bad] = [item(), item(), item()];
    const store = fakeStore([[gone, busy, bad]]);
    const { value, reportBug } = deps(
      store,
      answering({
        [gone.endpoint]: { status: 410, retryAfter: null },
        [busy.endpoint]: { status: 429, retryAfter: "30" },
        [bad.endpoint]: { status: 400, retryAfter: null },
      }),
    );
    const summary = await runPush(value, OPTIONS);
    expect(summary).toMatchObject({ sent: 0, gone: 1, retried: 1, dropped: 1 });
    expect(store.gone).toHaveBeenCalledWith(gone.id, "run-1");
    expect(store.retry).toHaveBeenCalledWith(busy.id, "run-1", 30);
    expect(store.drop).toHaveBeenCalledWith(bad.id, "run-1");
    expect(reportBug).toHaveBeenCalledWith("Web Push 400");
  });

  it("never has more than `concurrency` requests in flight", async () => {
    const store = fakeStore([
      [item(), item(), item()],
      [item(), item(), item()],
    ]);
    let inFlight = 0;
    let most = 0;
    const { value } = deps(store, async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { status: 201, retryAfter: null };
    });
    await runPush(value, OPTIONS);
    expect(most).toBe(3);
    expect(store.claim).toHaveBeenCalledWith("run-1", 3, 120);
  });

  it("starts the next delivery as soon as one finishes, so a slow device never holds up the rest", async () => {
    const slow = item();
    const store = fakeStore([[slow, item(), item(), item(), item()]]);
    const events: string[] = [];
    const { value } = deps(store, async (target) => {
      events.push(
        `start ${target.endpoint === slow.endpoint ? "slow" : "fast"}`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, target.endpoint === slow.endpoint ? 40 : 2),
      );
      if (target.endpoint === slow.endpoint) {
        events.push("slow done");
      }
      return { status: 201, retryAfter: null };
    });
    const summary = await runPush(value, OPTIONS);
    expect(summary.sent).toBe(5);
    expect(events.indexOf("slow done")).toBe(events.length - 1);
  });

  it("drops and reports deliveries it couldn't read, and sends the rest", async () => {
    const store = fakeStore([[item()]]);
    store.claim.mockImplementationOnce(async () => ({
      dropped: 0,
      unreadable: 2,
      items: [item()],
    }));
    const { value, reportBug } = deps(store, answering());
    const summary = await runPush(value, OPTIONS);
    expect(summary).toMatchObject({ sent: 2, dropped: 2 });
    expect(reportBug).toHaveBeenCalledWith("Unreadable push deliveries: 2");
  });

  it("starts no batch once less than minLeftMs of the budget is left", async () => {
    const store = fakeStore([[item()], [item()], [item()]]);
    const clock = { t: 0 };
    const { value } = deps(
      store,
      async () => {
        clock.t += 20_000;
        return { status: 201, retryAfter: null };
      },
      clock,
    );
    const summary = await runPush(value, OPTIONS);
    // 0 s: batch 1 (→ 20 s); 20 s: batch 2 (→ 40 s); 40 s: 10 s left < 12 s, stop.
    expect(summary.sent).toBe(2);
    expect(store.claim).toHaveBeenCalledTimes(2);
  });

  it("keeps looking while the email worker runs, then stops on an empty claim", async () => {
    const store = fakeStore([[], [], [item()]]);
    let checks = 0;
    const { value, sleep } = deps(store, answering());
    const summary = await runPush(value, OPTIONS, {
      // Running for the first two empty claims, then finished.
      running: () => {
        checks += 1;
        return checks <= 2;
      },
    });
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(summary.sent).toBe(1);
    expect(store.claim).toHaveBeenCalledTimes(4);
  });

  it("counts what the claim dropped as stale", async () => {
    const store = fakeStore([]);
    store.claim.mockResolvedValueOnce({ dropped: 4, unreadable: 0, items: [] });
    const { value } = deps(store, answering());
    expect((await runPush(value, OPTIONS)).stale).toBe(4);
  });

  it("stops on a failed result write without leaving a send's failure unhandled", async () => {
    const store = fakeStore([[item(), item()]]);
    store.done
      .mockRejectedValueOnce(new Error("push_done failed: 08006"))
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error("push_done failed: 08006");
      });
    const unhandled = vi.fn<(reason: Error) => void>();
    process.on("unhandledRejection", unhandled);
    try {
      const { value } = deps(store, answering());
      await expect(runPush(value, OPTIONS)).rejects.toThrow("push_done failed");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("stops and rethrows when the database fails", async () => {
    const store = fakeStore([]);
    store.claim.mockRejectedValueOnce(new Error("push_claim failed: 08006"));
    const { value } = deps(store, answering());
    await expect(runPush(value, OPTIONS)).rejects.toThrow("push_claim failed");
  });
});
