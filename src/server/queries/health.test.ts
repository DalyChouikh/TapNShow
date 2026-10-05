import { describe, expect, it, vi } from "vitest";
import { getDatabaseTime, type HealthcheckClient } from "./health";

function clientReturning(result: {
  data: string | null;
  error: { message: string } | null;
}): HealthcheckClient {
  return { rpc: vi.fn(async () => result) };
}

describe("getDatabaseTime", () => {
  it("returns the database timestamp", async () => {
    await expect(
      getDatabaseTime(
        clientReturning({ data: "2026-10-05T10:00:00+00:00", error: null }),
      ),
    ).resolves.toBe("2026-10-05T10:00:00+00:00");
  });

  it("throws on database errors", async () => {
    await expect(
      getDatabaseTime(
        clientReturning({ data: null, error: { message: "boom" } }),
      ),
    ).rejects.toThrow("boom");
  });
});
