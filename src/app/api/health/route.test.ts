import { describe, expect, it, vi } from "vitest";

const { getDatabaseTime, logError } = vi.hoisted(() => ({
  getDatabaseTime: vi.fn(async (): Promise<string> => ""),
  logError: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: logError, info: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/server/queries/health", () => ({ getDatabaseTime }));
vi.mock("@/server/supabase/admin-client", () => ({
  createSupabaseAdminClient: () => ({ rpc: vi.fn() }),
}));

describe("GET /api/health", () => {
  it("returns ok with the database time", async () => {
    getDatabaseTime.mockResolvedValueOnce("2026-10-05T10:00:00+00:00");
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      app: "TapNShow",
      databaseTime: "2026-10-05T10:00:00+00:00",
    });
  });

  it("returns 503 without leaking the error", async () => {
    getDatabaseTime.mockRejectedValueOnce(
      new Error("connection refused at 10.0.0.1"),
    );
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("10.0.0.1");
    expect(logError).toHaveBeenCalledOnce();
  });
});
