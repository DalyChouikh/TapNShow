import { describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/server/supabase/admin-client", () => ({
  createSupabaseAdminClient: () => ({ rpc }),
}));
const { error } = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error } }));

const request = new Request("http://localhost:3000/api/auth/otp/send", {
  headers: { "x-real-ip": "203.0.113.5" },
});

describe("allowIpRequest", () => {
  it("passes the action and the IP to check_ip_rate_limit", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    const { allowIpRequest } = await import("./ip-rate-limit");
    await expect(allowIpRequest("otp_send", "203.0.113.5")).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("check_ip_rate_limit", {
      p_action: "otp_send",
      p_ip: "203.0.113.5",
    });
  });

  it("answers false when the IP is over the Google sign-in limit", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    const { allowIpRequest } = await import("./ip-rate-limit");
    await expect(allowIpRequest("google_signin", "198.51.100.7")).resolves.toBe(
      false,
    );
    expect(rpc).toHaveBeenCalledWith("check_ip_rate_limit", {
      p_action: "google_signin",
      p_ip: "198.51.100.7",
    });
  });

  it("throws on database errors (the route answers 500)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    const { allowIpRequest } = await import("./ip-rate-limit");
    await expect(allowIpRequest("otp_send", "203.0.113.5")).rejects.toThrow(
      "down",
    );
  });
});

describe("checkIpLimit", () => {
  it.each([
    [true, "allowed"],
    [false, "limited"],
  ] as const)(
    "answers %s as %s, for the request's IP",
    async (data, verdict) => {
      rpc.mockResolvedValueOnce({ data, error: null });
      const { checkIpLimit } = await import("./ip-rate-limit");
      await expect(checkIpLimit("otp_verify", request)).resolves.toBe(verdict);
      expect(rpc).toHaveBeenCalledWith("check_ip_rate_limit", {
        p_action: "otp_verify",
        p_ip: "203.0.113.5",
      });
    },
  );

  it("logs a database failure once and answers failed", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    const { checkIpLimit } = await import("./ip-rate-limit");
    await expect(checkIpLimit("google_signin", request)).resolves.toBe(
      "failed",
    );
    expect(error).toHaveBeenCalledOnce();
  });
});
