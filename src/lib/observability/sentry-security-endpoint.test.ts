import { describe, expect, it } from "vitest";
import { sentrySecurityEndpoint } from "./sentry-security-endpoint";

describe("sentrySecurityEndpoint", () => {
  it("turns a DSN into Sentry's CSP report address", () => {
    expect(
      sentrySecurityEndpoint(
        "https://abc123@o4507.ingest.de.sentry.io/4508",
        "production",
      ),
    ).toBe(
      "https://o4507.ingest.de.sentry.io/api/4508/security/?sentry_key=abc123&sentry_environment=production",
    );
  });

  it("has none without a DSN (local, CI) or with a malformed one", () => {
    expect(sentrySecurityEndpoint(undefined, "development")).toBeUndefined();
    expect(sentrySecurityEndpoint("not a url", "development")).toBeUndefined();
  });
});
