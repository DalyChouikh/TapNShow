import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "a@example.test" } as {
    id: string;
    email: string | null;
  } | null,
  configured: true,
  subscribePush: vi.fn(async () => ({
    error: null as { message: string } | null,
  })),
  unsubscribePush: vi.fn(async () => ({
    error: null as { message: string } | null,
  })),
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => mocks.user,
}));
vi.mock("@/server/push/push-deps", () => ({
  pushConfigured: () => mocks.configured,
}));
vi.mock("@/server/queries/push", () => ({
  subscribePush: mocks.subscribePush,
  unsubscribePush: mocks.unsubscribePush,
}));

const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
};
const call = (
  method: "POST" | "DELETE",
  body: object,
  origin = "http://localhost:3000",
) =>
  new Request("http://localhost:3000/api/me/push-subscriptions", {
    method,
    headers: { origin },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "u1", email: "a@example.test" };
  mocks.configured = true;
});

describe("/api/me/push-subscriptions", () => {
  it("turns reminders on for this browser", async () => {
    const { POST } = await import("./route");
    const response = await POST(call("POST", subscription));
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.subscribePush).toHaveBeenCalledWith({}, subscription);
  });

  it("turns them off for this browser", async () => {
    const { DELETE } = await import("./route");
    const response = await DELETE(
      call("DELETE", { endpoint: subscription.endpoint }),
    );
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.unsubscribePush).toHaveBeenCalledWith(
      {},
      subscription.endpoint,
    );
  });

  it("needs the same origin, a session and a valid body; maps the rate limit", async () => {
    const { POST } = await import("./route");
    expect(
      (await POST(call("POST", subscription, "https://evil.example"))).status,
    ).toBe(403);
    expect((await POST(call("POST", { endpoint: "http://x" }))).status).toBe(
      400,
    );
    mocks.subscribePush.mockResolvedValueOnce({
      error: { message: "tn:rate_limited" },
    });
    expect((await POST(call("POST", subscription))).status).toBe(429);
    mocks.user = null;
    expect((await POST(call("POST", subscription))).status).toBe(401);
  });

  it("can't turn reminders on without the keys, but can always turn them off (sign-out)", async () => {
    mocks.configured = false;
    const { DELETE, POST } = await import("./route");
    const refused = await POST(call("POST", subscription));
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({
      error: { code: "reminders_unavailable" },
    });
    expect(
      (await DELETE(call("DELETE", { endpoint: subscription.endpoint })))
        .status,
    ).toBe(200);
    expect(mocks.unsubscribePush).toHaveBeenCalledOnce();
  });
});
