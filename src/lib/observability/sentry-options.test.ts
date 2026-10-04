import type { ErrorEvent, TransactionEvent } from "@sentry/core";
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
    expect(options.beforeSend(event)?.request?.url).toBe(
      "https://x.app/r/[REDACTED]",
    );
  });
});

describe("buildSentryOptions privacy scrubbing", () => {
  const options = buildSentryOptions({ environment: "test" });
  const TOKEN = "tok_abc123";

  it("drops cookie, authorization and referer headers from error events", () => {
    const event = {
      type: undefined,
      request: {
        url: "https://x.app/api/responses",
        headers: {
          cookie: "sb-access-token=secret",
          authorization: "Bearer secret",
          referer: `https://x.app/r/${TOKEN}`,
          "user-agent": "test",
        },
      },
    } as ErrorEvent;
    const headers = options.beforeSend(event)?.request?.headers ?? {};
    expect(headers).toEqual({ "user-agent": "test" });
  });

  it("scrubs the transaction name and breadcrumb URLs of error events", () => {
    const event = {
      type: undefined,
      transaction: `GET /r/${TOKEN}`,
      breadcrumbs: [
        { category: "navigation", data: { from: "/", to: `/r/${TOKEN}` } },
        {
          category: "fetch",
          data: { url: `https://x.app/r/${TOKEN}?choice=late` },
        },
        { category: "console", message: `opened /r/${TOKEN}` },
      ],
    } as ErrorEvent;
    const serialized = JSON.stringify(options.beforeSend(event));
    expect(serialized).not.toContain(TOKEN);
  });

  it("scrubs request paths that onRequestError puts in contexts", () => {
    const event = {
      type: undefined,
      contexts: {
        nextjs: {
          request_path: `/r/${TOKEN}`,
          router_path: "/r/[token]",
        },
      },
    } as ErrorEvent;
    const scrubbed = options.beforeSend(event);
    expect(JSON.stringify(scrubbed)).not.toContain(TOKEN);
    expect(scrubbed?.contexts?.nextjs?.router_path).toBe("/r/[token]");
  });

  it("scrubs transaction events (traces)", () => {
    const event = {
      type: "transaction",
      transaction: `GET /r/${TOKEN}`,
      request: { url: `https://x.app/r/${TOKEN}`, headers: { cookie: "c=1" } },
      spans: [
        {
          span_id: "1",
          trace_id: "2",
          start_timestamp: 0,
          status: "ok",
          description: `GET https://x.app/r/${TOKEN}`,
          data: { "url.full": `https://x.app/r/${TOKEN}` },
        },
      ],
    } as TransactionEvent;
    const serialized = JSON.stringify(options.beforeSendTransaction(event));
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain("c=1");
  });

  it("scrubs breadcrumbs as they are recorded", () => {
    const crumb = options.beforeBreadcrumb({
      category: "navigation",
      data: { from: `/r/${TOKEN}`, to: "/invites" },
    });
    expect(JSON.stringify(crumb)).not.toContain(TOKEN);
  });

  it("scrubs tokens inside exception messages and nested values", () => {
    const event = {
      type: undefined,
      exception: {
        values: [{ type: "TypeError", value: `fetch failed: /r/${TOKEN}` }],
      },
      contexts: {
        trace: {
          trace_id: "t",
          span_id: "s",
          data: { "url.full": `https://x.app/r/${TOKEN}` },
        },
      },
      extra: { nested: { deeper: [`/r/${TOKEN}`] } },
    } as ErrorEvent;
    expect(JSON.stringify(options.beforeSend(event))).not.toContain(TOKEN);
  });

  it("drops request cookies and body (may contain absence reasons)", () => {
    const event = {
      type: undefined,
      request: {
        url: "https://x.app/api/responses",
        cookies: { "sb-access-token": "secret-cookie" },
        data: { reason: "medical appointment" },
      },
    } as ErrorEvent;
    const request = options.beforeSend(event)?.request;
    expect(request?.cookies).toBeUndefined();
    expect(request?.data).toBeUndefined();
    expect(request?.url).toBe("https://x.app/api/responses");
  });

  it("scrubs tokens next to escaped quotes and backslashes", () => {
    const event = {
      type: undefined,
      message: `bad link /r/${TOKEN}"tail and /r/${TOKEN}\\tail`,
    } as ErrorEvent;
    const result = options.beforeSend(event);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("scrubs percent-encoded and upper-case personal links", () => {
    const event = {
      type: undefined,
      extra: {
        next: `https://x.app/login?next=%2Fr%2F${TOKEN}`,
        upper: `/R/${TOKEN}`,
      },
    } as ErrorEvent;
    expect(JSON.stringify(options.beforeSend(event))).not.toContain(TOKEN);
  });

  it("does not throw on circular payloads and still scrubs", () => {
    const extra: Record<string, object | string> = { link: `/r/${TOKEN}` };
    extra.self = extra;
    const event = { type: undefined, extra } as ErrorEvent;
    const result = options.beforeSend(event);
    expect(result).not.toBeNull();
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("fails closed: drops the event if sanitizing throws", () => {
    const event = { type: undefined } as ErrorEvent;
    Object.defineProperty(event, "extra", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(options.beforeSend(event)).toBeNull();
  });

  it("redacts values stored under sensitive field names at any depth", () => {
    const event = {
      type: undefined,
      extra: {
        token: "raw-token-value",
        nested: {
          refresh_token: "raw-refresh",
          refreshToken: "raw-refresh-2",
          Authorization: "Bearer raw-auth",
          password: "raw-password",
          apiKey: "raw-key",
          safe: "visible",
        },
      },
    } as ErrorEvent;
    const serialized = JSON.stringify(options.beforeSend(event));
    for (const secret of [
      "raw-token-value",
      "raw-refresh",
      "raw-refresh-2",
      "raw-auth",
      "raw-password",
      "raw-key",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("visible");
  });

  it("scrubs personal links used as object keys", () => {
    const event = {
      type: undefined,
      extra: { [`/r/${TOKEN}`]: 1 },
    } as ErrorEvent;
    expect(JSON.stringify(options.beforeSend(event))).not.toContain(TOKEN);
  });
});
