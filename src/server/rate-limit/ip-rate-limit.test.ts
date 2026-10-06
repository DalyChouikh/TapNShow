import { describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/server/supabase/admin-client", () => ({
  createSupabaseAdminClient: () => ({ rpc }),
}));

describe("allowOtpRequest", () => {
  it("passes the IP to check_ip_rate_limit", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    const { allowOtpRequest } = await import("./ip-rate-limit");
    await expect(allowOtpRequest("203.0.113.5")).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("check_ip_rate_limit", {
      p_action: "otp_send",
      p_ip: "203.0.113.5",
    });
  });

  it("throws on database errors (the route answers 500)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    const { allowOtpRequest } = await import("./ip-rate-limit");
    await expect(allowOtpRequest("203.0.113.5")).rejects.toThrow("down");
  });
});
