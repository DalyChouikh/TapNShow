import { describe, expect, it, vi } from "vitest";
import { pingProject, weeklyReport } from "./keep-alive";

describe("pingProject", () => {
  it("calls keep_alive with the public key and reports the answer", async () => {
    const fetch = vi.fn<
      (input: string, init: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response(JSON.stringify("2026-10-15T05:17:00+00:00"), {
          status: 200,
        }),
    );
    await expect(
      pingProject(
        {
          name: "Production",
          url: "https://p.supabase.co",
          key: "sb_publishable_x",
        },
        fetch,
      ),
    ).resolves.toEqual({ name: "Production", ok: true, status: 200 });
    const [target, init] = fetch.mock.calls[0];
    expect(target).toBe("https://p.supabase.co/rest/v1/rpc/keep_alive");
    expect(new Headers(init.headers).get("apikey")).toBe("sb_publishable_x");
  });

  it("reports a failure, including a network error", async () => {
    const fetch = vi.fn<
      (input: string, init: RequestInit) => Promise<Response>
    >(async () => {
      throw new Error("ENOTFOUND");
    });
    await expect(
      pingProject(
        { name: "Preview", url: "https://q.supabase.co", key: "k" },
        fetch,
      ),
    ).resolves.toEqual({ name: "Preview", ok: false, status: 0 });
  });
});

describe("weeklyReport", () => {
  it("is due on Mondays at the morning run only", () => {
    expect(weeklyReport(new Date("2026-10-19T05:17:00Z"))).toBe(true);
    expect(weeklyReport(new Date("2026-10-19T17:17:00Z"))).toBe(false);
    expect(weeklyReport(new Date("2026-10-20T05:17:00Z"))).toBe(false);
  });
});
