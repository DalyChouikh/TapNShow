import { describe, expect, it, vi } from "vitest";
import type { SystemEmail } from "@/server/email/system-mailer";

const mocks = vi.hoisted(() => ({
  budget: vi.fn<
    () => Promise<{ data: boolean | null; error: { message: string } | null }>
  >(async () => ({ data: true, error: null })),
}));
vi.mock("@/server/queries/admin", () => ({
  consumeAdminInviteEmail: mocks.budget,
}));

const { deliverAdminInvite } = await import("./deliver-admin-invite");

function input(delivery: "email" | "link") {
  const send = vi.fn<(email: SystemEmail) => Promise<void>>(
    async () => undefined,
  );
  return {
    send,
    args: {
      supabase: {} as never,
      token: "t".repeat(43),
      email: "new@example.test",
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      delivery,
      origin: "https://tapnshow.vercel.app",
      inviterName: "Mohamed",
      mailer: { send },
    },
  };
}

describe("deliverAdminInvite", () => {
  it("returns the join link without spending any budget", async () => {
    const { args, send } = input("link");
    expect(await deliverAdminInvite(args)).toEqual({
      status: "link",
      link: `https://tapnshow.vercel.app/admin/join/${"t".repeat(43)}`,
    });
    expect(mocks.budget).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("emails the invited address within the platform budget", async () => {
    const { args, send } = input("email");
    expect(await deliverAdminInvite(args)).toEqual({ status: "sent" });
    expect(send.mock.calls[0][0].to).toBe("new@example.test");
    expect(send.mock.calls[0][0].html).toContain("/admin/join/");
  });

  it("says when the daily budget is spent, and when the send fails (the invite stays valid)", async () => {
    mocks.budget.mockResolvedValueOnce({ data: false, error: null });
    expect(await deliverAdminInvite(input("email").args)).toEqual({
      status: "email_limit",
    });
    const failing = input("email");
    failing.send.mockRejectedValueOnce(new Error("smtp down"));
    expect(await deliverAdminInvite(failing.args)).toEqual({
      status: "email_failed",
    });
  });
});
