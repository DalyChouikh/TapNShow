import { describe, expect, it, vi } from "vitest";
import type { DiscordMessage } from "@/lib/discord/embed";
import type { PlatformEvent } from "@/lib/discord/platform-events";
import type { OwnerAlertInput } from "@/server/email/owner-alert";
import type { PlatformOwnerTarget } from "@/server/queries/platform";
import { type PlatformDeps, runPlatformEvents } from "./run-platform-events";

const OPTIONS = { budgetMs: 40_000, batchSize: 10, leaseSeconds: 120 };
const WEBHOOK = "https://discord.com/api/webhooks/1/token";
const TARGET: PlatformOwnerTarget = {
  email: "owner@example.test",
  workspaceName: "Robotics Club",
  workspaceSlug: "robotics-ab12",
};

function event(overrides: Partial<PlatformEvent> = {}): PlatformEvent {
  return {
    id: 1,
    kind: "auto_suspended",
    workspaceId: "11111111-1111-4111-8111-111111111111",
    workspaceName: "Robotics Club",
    workspaceSlug: "robotics-ab12",
    facts: { reports: 3, people: 74 },
    createdAt: "2026-10-16T09:12:00Z",
    actorRole: null,
    emailedAt: null,
    attempts: 0,
    ...overrides,
  };
}

/**
 * Fakes that hand out `batches` one claim at a time; the owner target answers once per event
 * (like `platform_event_owner_target`, which stamps `emailed_at`).
 */
function fakes(batches: PlatformEvent[][]) {
  const queue = [...batches];
  const targeted = new Set<number>();
  const deps = {
    appUrl: "https://tapnshow.vercel.app",
    webhook: WEBHOOK as string | undefined,
    now: vi.fn<() => number>(() => 0),
    store: {
      claim: vi.fn<PlatformDeps["store"]["claim"]>(
        async () => queue.shift() ?? [],
      ),
      ownerTarget: vi.fn<PlatformDeps["store"]["ownerTarget"]>(async (id) => {
        if (targeted.has(id)) {
          return null;
        }
        targeted.add(id);
        return TARGET;
      }),
      done: vi.fn<PlatformDeps["store"]["done"]>(async () => undefined),
      failed: vi.fn<PlatformDeps["store"]["failed"]>(async () => 1),
    },
    post: vi.fn<
      (
        webhook: string,
        message: DiscordMessage,
      ) => Promise<{ ok: boolean; status: number }>
    >(async () => ({ ok: true, status: 200 })),
    alertOwner: vi.fn<(to: string, alert: OwnerAlertInput) => Promise<void>>(
      async () => undefined,
    ),
  } satisfies PlatformDeps;
  return deps;
}

describe("runPlatformEvents", () => {
  it("posts an automatic suspension once, emails the Owner once, then marks it done", async () => {
    const deps = fakes([[event()]]);
    const summary = await runPlatformEvents(deps, OPTIONS);
    expect(summary).toEqual({ posted: 1, emailed: 1, failed: 0 });
    expect(deps.post).toHaveBeenCalledOnce();
    expect(deps.post.mock.calls[0][0]).toBe(WEBHOOK);
    expect(deps.alertOwner).toHaveBeenCalledExactlyOnceWith(
      "owner@example.test",
      {
        kind: "sendingSuspended",
        workspaceName: "Robotics Club",
        workspaceSlug: "robotics-ab12",
      },
    );
    expect(deps.store.done).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("tells the Owner sending resumes on a lift", async () => {
    const deps = fakes([[event({ kind: "lifted", facts: {} })]]);
    await runPlatformEvents(deps, OPTIONS);
    expect(deps.alertOwner.mock.calls[0][1].kind).toBe("sendingResumed");
  });

  it("emails nobody for events that aren't about a workspace's sending", async () => {
    const deps = fakes([
      [
        event({ kind: "report" }),
        event({ id: 2, kind: "admin_joined", workspaceId: null }),
      ],
    ]);
    await runPlatformEvents(deps, OPTIONS);
    expect(deps.store.ownerTarget).not.toHaveBeenCalled();
    expect(deps.alertOwner).not.toHaveBeenCalled();
    expect(deps.post).toHaveBeenCalledTimes(2);
  });

  it("retries a failed post without emailing a second time", async () => {
    const deps = fakes([
      [event()],
      [event({ emailedAt: "2026-10-16T09:12:05Z", attempts: 1 })],
    ]);
    deps.post.mockResolvedValueOnce({ ok: false, status: 500 });
    const summary = await runPlatformEvents(deps, OPTIONS);
    expect(summary).toEqual({ posted: 1, emailed: 1, failed: 1 });
    expect(deps.store.failed).toHaveBeenCalledExactlyOnceWith(1);
    expect(deps.alertOwner).toHaveBeenCalledOnce();
    expect(deps.store.done).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("counts a network error as a failed post and carries on with the batch", async () => {
    const deps = fakes([[event(), event({ id: 2, kind: "report" })]]);
    deps.post.mockRejectedValueOnce(new Error("fetch failed"));
    const summary = await runPlatformEvents(deps, OPTIONS);
    expect(summary).toEqual({ posted: 1, emailed: 1, failed: 1 });
    expect(deps.store.failed).toHaveBeenCalledExactlyOnceWith(1);
    expect(deps.store.done).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("without a webhook marks events done without posting (the admin log is the record)", async () => {
    const deps = fakes([[event()]]);
    deps.webhook = undefined;
    const summary = await runPlatformEvents(deps, OPTIONS);
    expect(deps.post).not.toHaveBeenCalled();
    expect(deps.store.done).toHaveBeenCalledExactlyOnceWith(1);
    expect(summary).toEqual({ posted: 0, emailed: 1, failed: 0 });
  });

  it("stops claiming once the budget is spent", async () => {
    const deps = fakes([[event()], [event({ id: 2 })]]);
    deps.now
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(OPTIONS.budgetMs);
    await runPlatformEvents(deps, OPTIONS);
    expect(deps.store.claim).toHaveBeenCalledOnce();
  });

  it("still posts and marks done when the Owner email throws (the email is logged)", async () => {
    const deps = fakes([[event()]]);
    deps.alertOwner.mockRejectedValueOnce(new Error("smtp down"));
    const summary = await runPlatformEvents(deps, OPTIONS);
    expect(summary).toEqual({ posted: 1, emailed: 0, failed: 0 });
    expect(deps.store.done).toHaveBeenCalledExactlyOnceWith(1);
  });
});
