import webpush from "web-push";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPushSender, pushTopic } from "./send";

const vapid = (() => {
  const keys = webpush.generateVAPIDKeys();
  return {
    subject: "mailto:admin@example.test",
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
  };
})();
// A real browser key pair, so web-push can encrypt (RFC 8291).
const browser = (() => {
  const keys = webpush.generateVAPIDKeys();
  return { p256dh: keys.publicKey, auth: "AAAAAAAAAAAAAAAAAAAAAA" };
})();
const target = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  ...browser,
};
const options = {
  ttl: 3600,
  urgency: "normal" as const,
  topic: pushTopic("invite:x"),
};

afterEach(() => vi.unstubAllGlobals());

function stubFetch(
  handler: (url: string, init: RequestInit) => Promise<Response>,
) {
  const fetchMock =
    vi.fn<(url: string, init: RequestInit) => Promise<Response>>(handler);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("createPushSender", () => {
  it("posts the encrypted payload once, signed, with TTL, Urgency and Topic, never following redirects", async () => {
    const fetchMock = stubFetch(
      async () => new Response(null, { status: 201 }),
    );
    const send = createPushSender(vapid, 10_000);
    expect(await send(target, '{"title":"x"}', options)).toEqual({
      status: 201,
      retryAfter: null,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(target.endpoint);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init.headers);
    expect(headers.get("ttl")).toBe("3600");
    expect(headers.get("urgency")).toBe("normal");
    expect(headers.get("topic")).toBe(options.topic);
    expect(headers.get("content-encoding")).toBe("aes128gcm");
    expect(headers.get("authorization")).toMatch(/^vapid t=.+, k=.+$/);
    expect(init.body).toBeInstanceOf(Uint8Array);
  });

  it("returns the status and Retry-After of a refusal", async () => {
    stubFetch(
      async () =>
        new Response("slow down", {
          status: 429,
          headers: { "retry-after": "30" },
        }),
    );
    const send = createPushSender(vapid, 10_000);
    expect(await send(target, "{}", options)).toEqual({
      status: 429,
      retryAfter: "30",
    });
  });

  it("treats a redirect as an answer, never a hop to another host", async () => {
    stubFetch(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example.test" },
        }),
    );
    const send = createPushSender(vapid, 10_000);
    expect(await send(target, "{}", options)).toEqual({
      status: 302,
      retryAfter: null,
    });
  });

  it("returns no status when the network fails or the whole request runs out of time", async () => {
    stubFetch(async (_url, init) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      init.signal?.throwIfAborted();
      return new Response(null, { status: 201 });
    });
    const send = createPushSender(vapid, 10);
    expect(await send(target, "{}", options)).toEqual({ status: null });
    stubFetch(async () => Promise.reject(new TypeError("fetch failed")));
    expect(
      await createPushSender(vapid, 10_000)(target, "{}", options),
    ).toEqual({ status: null });
  });
});

describe("pushTopic", () => {
  it("is a stable 32-character URL-safe value (RFC 8030 Topic)", () => {
    const topic = pushTopic("invite:6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa");
    expect(topic).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(pushTopic("invite:6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa")).toBe(
      topic,
    );
    expect(pushTopic("cancel:6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa")).not.toBe(
      topic,
    );
  });
});
