import { describe, expect, it } from "vitest";
import {
  CSP_HEADER,
  CSP_REPORT_GROUP,
  contentSecurityPolicy,
  noIndexHeaders,
  reportingEndpoints,
  serviceWorkerCsp,
  serviceWorkerHeaders,
  staticSecurityHeaders,
  tokenPageHeaders,
} from "./security-headers";

describe("tokenPageHeaders", () => {
  it("sends no referrer from pages whose URL carries a token", () => {
    const sources = tokenPageHeaders.map((rule) => rule.source);
    expect(sources).toEqual([
      "/invite/:token*",
      "/r/:token*",
      "/u/:token*",
      "/report/:token*",
      "/api/r/:token*",
      "/api/me/invites/:id/link",
      "/admin/join/:token*",
    ]);
    for (const rule of tokenPageHeaders) {
      expect(rule.headers).toContainEqual({
        key: "Referrer-Policy",
        value: "no-referrer",
      });
    }
  });
});

describe("serviceWorkerHeaders (spec §10 PWA)", () => {
  it("serves the worker uncached and lets it control the whole app from /serwist/", () => {
    expect(serviceWorkerHeaders).toEqual([
      {
        source: "/serwist/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ]);
  });
});

describe("contentSecurityPolicy (spec §11 M9)", () => {
  const directives = (policy: string) =>
    Object.fromEntries(
      policy.split(";").map((part) => {
        const [name, ...values] = part.trim().split(/\s+/);
        return [name, values];
      }),
    );

  it("allows only our own origin, scripts by nonce, and no plugins, frames or base", () => {
    const policy = directives(
      contentSecurityPolicy({ nonce: "abc", development: false }),
    );
    expect(policy["default-src"]).toEqual(["'self'"]);
    expect(policy["script-src"]).toEqual([
      "'self'",
      "'nonce-abc'",
      "'strict-dynamic'",
    ]);
    expect(policy["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy["img-src"]).toEqual(["'self'", "data:", "blob:"]);
    expect(policy["connect-src"]).toEqual(["'self'"]);
    for (const name of [
      "font-src",
      "worker-src",
      "manifest-src",
      "form-action",
    ]) {
      expect(policy[name]).toEqual(["'self'"]);
    }
    for (const name of ["object-src", "base-uri", "frame-ancestors"]) {
      expect(policy[name]).toEqual(["'none'"]);
    }
    expect(policy["report-uri"]).toBeUndefined();
  });

  it("adds unsafe-eval in development only (React's dev error stacks) and the report endpoint", () => {
    const policy = directives(
      contentSecurityPolicy({
        nonce: "n",
        development: true,
        reportUri:
          "https://o1.ingest.de.sentry.io/api/2/security/?sentry_key=k",
      }),
    );
    expect(policy["script-src"]).toContain("'unsafe-eval'");
    expect(policy["report-uri"]).toEqual([
      "https://o1.ingest.de.sentry.io/api/2/security/?sentry_key=k",
    ]);
    expect(policy["report-to"]).toEqual([CSP_REPORT_GROUP]);
  });

  it("names the report group's address, which report-to needs (without it Chromium drops every report)", () => {
    expect(
      reportingEndpoints(
        "https://o1.ingest.de.sentry.io/api/2/security/?sentry_key=k",
      ),
    ).toBe(
      `${CSP_REPORT_GROUP}="https://o1.ingest.de.sentry.io/api/2/security/?sentry_key=k"`,
    );
  });

  it("is enforced (spec §11 M9: the launch task, after 3 clean days of report-only)", () => {
    expect(CSP_HEADER).toBe("Content-Security-Policy");
  });
});

describe("staticSecurityHeaders", () => {
  it("applies HSTS for every subdomain, nosniff, a strict referrer and no camera, microphone or location to everything", () => {
    expect(staticSecurityHeaders).toEqual([
      {
        source: "/:path*",
        headers: [
          // Two years like Vercel's default, every subdomain, never preload (#422).
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ]);
  });
});

describe("noIndexHeaders", () => {
  it("keeps every private and token address out of search engines", () => {
    expect(noIndexHeaders.map((rule) => rule.source)).toEqual([
      "/w/:path*",
      "/r/:path*",
      "/u/:path*",
      "/report/:path*",
      "/invite/:path*",
      "/admin/:path*",
      "/admin",
      "/api/:path*",
    ]);
    for (const rule of noIndexHeaders) {
      expect(rule.headers).toEqual([
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ]);
    }
  });
});

describe("serviceWorkerCsp", () => {
  it("lets the worker reach only our own origin", () => {
    expect(serviceWorkerCsp.source).toBe("/serwist/:path*");
    expect(serviceWorkerCsp.headers).toEqual([
      {
        key: CSP_HEADER,
        value: "default-src 'self'; script-src 'self'; connect-src 'self'",
      },
    ]);
  });
});
