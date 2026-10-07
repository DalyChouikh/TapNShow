import { describe, expect, it, vi } from "vitest";
import { classifyGmailResponse, sendGmailMessage } from "./gmail-client";

const error = (
  code: number,
  reason: string,
  message: string,
  domain = "global",
) =>
  JSON.stringify({
    error: { code, message, errors: [{ domain, reason, message }] },
  });

describe("sendGmailMessage", () => {
  it("posts raw (and threadId when threading) and returns ids", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ id: "m1", threadId: "t1", labelIds: ["SENT"] }),
          { status: 200 },
        ),
      );
    const result = await sendGmailMessage(
      {
        baseUrl: "https://gmail.googleapis.com",
        accessToken: "at",
        raw: "UkFX",
        threadId: "t1",
        timeoutMs: 1000,
      },
      fetchMock,
    );
    expect(result).toEqual({ kind: "sent", id: "m1", threadId: "t1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    );
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer at");
    expect(JSON.parse(String(init?.body))).toEqual({
      raw: "UkFX",
      threadId: "t1",
    });
  });

  it("omits threadId for a root email", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "m", threadId: "t" })),
      );
    await sendGmailMessage(
      {
        baseUrl: "https://g",
        accessToken: "a",
        raw: "r",
        threadId: null,
        timeoutMs: 1000,
      },
      fetchMock,
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      raw: "r",
    });
  });

  it("reports 'unknown' when no HTTP response came back", async () => {
    const network = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed"));
    expect(
      (
        await sendGmailMessage(
          {
            baseUrl: "https://g",
            accessToken: "a",
            raw: "r",
            threadId: null,
            timeoutMs: 1000,
          },
          network,
        )
      ).kind,
    ).toBe("unknown");
    const timeout = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    expect(
      (
        await sendGmailMessage(
          {
            baseUrl: "https://g",
            accessToken: "a",
            raw: "r",
            threadId: null,
            timeoutMs: 1000,
          },
          timeout,
        )
      ).kind,
    ).toBe("unknown");
  });
});

describe("classifyGmailResponse", () => {
  it.each([
    [400, error(400, "badRequest", "Invalid To header"), "invalid_recipient"],
    [401, error(401, "authError", "Invalid Credentials"), "auth"],
    [
      403,
      error(
        403,
        "userRateLimitExceeded",
        "User Rate Limit Exceeded",
        "usageLimits",
      ),
      "throttled",
    ],
    [
      403,
      error(403, "dailyLimitExceeded", "Daily Limit Exceeded", "usageLimits"),
      "throttled",
    ],
    [403, error(403, "domainPolicy", "Not allowed"), "forbidden"],
    [
      404,
      error(404, "notFound", "Requested entity was not found."),
      "thread_missing",
    ],
    [
      429,
      error(
        429,
        "rateLimitExceeded",
        "User-rate limit exceeded (Mail sending)",
      ),
      "throttled",
    ],
    [
      429,
      error(429, "rateLimitExceeded", "Too many concurrent requests for user"),
      "retry",
    ],
    [500, error(500, "backendError", "Backend Error"), "retry"],
    [503, "Service Unavailable", "retry"],
  ])("maps HTTP %i to the right action", (status, body, kind) => {
    expect(classifyGmailResponse(status, body).kind).toBe(kind);
  });

  it("never echoes the response body into the reason beyond Google's short message", () => {
    const result = classifyGmailResponse(
      400,
      error(400, "badRequest", "Invalid To header"),
    );
    expect(result).toEqual({
      kind: "invalid_recipient",
      reason: "Invalid To header",
    });
  });
});
