import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { CSP_HEADER } from "@/config/security-headers";

const forwarded = vi.hoisted(() => ({ headers: null as Headers | null }));
vi.mock("@/server/supabase/proxy-session", async () => {
  const { NextResponse } = await import("next/server");
  return {
    updateSession: async (_request: NextRequest, extra: Headers) => {
      forwarded.headers = extra;
      return NextResponse.next();
    },
  };
});

describe("proxy (CSP nonce)", () => {
  it("makes a fresh nonce per request, forwards it and sets the policy", async () => {
    const { proxy } = await import("./proxy");
    const first = await proxy(new NextRequest("http://localhost:3000/"));
    const nonceA = forwarded.headers?.get("x-nonce");
    const second = await proxy(new NextRequest("http://localhost:3000/"));
    const nonceB = forwarded.headers?.get("x-nonce");
    expect(nonceA).toMatch(/^[A-Za-z0-9+/=]{24,}$/);
    expect(nonceB).not.toBe(nonceA);
    const policy = first.headers.get(CSP_HEADER);
    expect(policy).toContain(`'nonce-${nonceA}'`);
    expect(forwarded.headers?.get(CSP_HEADER)).toBe(
      second.headers.get(CSP_HEADER),
    );
    // No DSN in tests: no report address, so no report directives and no Reporting-Endpoints.
    expect(policy).not.toContain("report-");
    expect(first.headers.get("Reporting-Endpoints")).toBeNull();
  });
});
