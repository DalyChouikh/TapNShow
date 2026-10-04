import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { buildSentryOptions } from "./sentry-options";

describe("buildSentryOptions", () => {
  it("is disabled without a DSN", () => {
    expect(buildSentryOptions({ environment: "test" }).enabled).toBe(false);
  });

  it("is enabled with a DSN and never sends PII", () => {
    const options = buildSentryOptions({
      dsn: "https://k@o1.ingest.sentry.io/1",
      environment: "production",
    });
    expect(options.enabled).toBe(true);
    expect(options.sendDefaultPii).toBe(false);
  });

  it("scrubs token URLs from events", () => {
    const options = buildSentryOptions({ environment: "test" });
    const event = {
      type: undefined,
      request: { url: "https://x.app/r/secret-token" },
    } as ErrorEvent;
    expect(options.beforeSend(event).request?.url).toBe(
      "https://x.app/r/[REDACTED]",
    );
  });
});
