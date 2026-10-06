import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/db/database.types";
import type { Invite } from "@/shared/api/invites";

const mocks = vi.hoisted(() => ({
  consumeInviteEmail: vi.fn(async () => ({
    data: true as boolean | null,
    error: null as { message: string } | null,
  })),
  getInvite: vi.fn(async (): Promise<Invite | null> => ({
    id: "i1",
    email: "v@example.test",
    role: "viewer",
    status: "pending",
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    createdAt: "",
  })),
  send: vi.fn(async () => undefined),
}));
vi.mock("@/server/queries/invites", () => ({
  consumeInviteEmail: mocks.consumeInviteEmail,
  getInvite: mocks.getInvite,
}));

const base = {
  // Never used for network calls: the query module is mocked.
  supabase: createClient<Database>("http://127.0.0.1:1", "sb_publishable_test"),
  workspaceId: "w1",
  inviteId: "i1",
  token: "T".repeat(43),
  origin: "https://tapnshow.vercel.app",
  inviterName: "Amira",
  workspaceName: "Robotics Club",
};

beforeEach(() => vi.clearAllMocks());

describe("deliverInvite", () => {
  it("returns the link for copy delivery without sending or consuming budget", async () => {
    const { deliverInvite } = await import("./deliver-invite");
    const response = await deliverInvite({
      ...base,
      delivery: "link",
      mailer: { send: mocks.send },
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: "i1",
      delivery: "link",
      link: `https://tapnshow.vercel.app/invite/${"T".repeat(43)}`,
    });
    expect(mocks.consumeInviteEmail).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("emails the invite with the request origin's link", async () => {
    const { deliverInvite } = await import("./deliver-invite");
    const response = await deliverInvite({
      ...base,
      delivery: "email",
      mailer: { send: mocks.send },
    });
    expect(await response.json()).toEqual({ id: "i1", delivery: "email" });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "v@example.test",
        subject: "Amira invited you to Robotics Club on TapNShow",
      }),
    );
  });

  it("answers invite_email_limit with the invite id when the budget is used up", async () => {
    mocks.consumeInviteEmail.mockResolvedValueOnce({
      data: false,
      error: null,
    });
    const { deliverInvite } = await import("./deliver-invite");
    const response = await deliverInvite({
      ...base,
      delivery: "email",
      mailer: { send: mocks.send },
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: { code: "invite_email_limit", details: { inviteId: "i1" } },
    });
  });

  it("answers email_failed with the invite id when SMTP fails", async () => {
    mocks.send.mockRejectedValueOnce(new Error("535 auth failed"));
    const { deliverInvite } = await import("./deliver-invite");
    const response = await deliverInvite({
      ...base,
      delivery: "email",
      mailer: { send: mocks.send },
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: { code: "email_failed", details: { inviteId: "i1" } },
    });
  });

  it("does not spend email budget when the invite no longer exists", async () => {
    mocks.getInvite.mockResolvedValueOnce(null);
    const { deliverInvite } = await import("./deliver-invite");
    const response = await deliverInvite({
      ...base,
      delivery: "email",
      mailer: { send: mocks.send },
    });
    expect(response.status).toBe(404);
    expect(mocks.consumeInviteEmail).not.toHaveBeenCalled();
  });
});
