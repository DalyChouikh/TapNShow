import { describe, expect, it, vi } from "vitest";
import {
  focusOrOpen,
  forgetWhenSignedOut,
  markSavedCopy,
  notificationFromPush,
  resubscribe,
} from "./sw-handlers";

const fallback = {
  title: "TapNShow",
  body: "You have an update from TapNShow.",
};

describe("notificationFromPush (spec §8: always show one)", () => {
  it("shows what the server built, with its tag, the app badge and the url to open", () => {
    const shown = notificationFromPush(
      JSON.stringify({
        title: "GDG ISSAT · Weekly sync",
        body: "New invite",
        url: "/invites/6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
        tag: "invite:6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
      }),
      fallback,
    );
    expect(shown).toEqual({
      title: "GDG ISSAT · Weekly sync",
      options: {
        body: "New invite",
        tag: "invite:6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-96.png",
        data: { url: "/invites/6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa" },
      },
    });
  });

  it("falls back to a plain notification for an empty, broken or foreign payload", () => {
    for (const text of [
      null,
      "",
      "{not json",
      JSON.stringify({ url: "https://evil.example" }),
    ]) {
      const shown = notificationFromPush(text, fallback);
      expect(shown.title).toBe("TapNShow");
      expect(shown.options.body).toBe(fallback.body);
      expect(shown.options.data).toEqual({ url: "/invites" });
    }
  });
});

describe("focusOrOpen", () => {
  it("navigates an open TapNShow window when there is one, else opens a new one", async () => {
    const navigate = vi.fn<(url: string) => Promise<object | null>>(
      async () => null,
    );
    const focus = vi.fn<() => Promise<object>>(async () => ({}));
    const openWindow = vi.fn<(url: string) => Promise<object | null>>(
      async () => null,
    );
    const client = {
      url: "https://tapnshow.vercel.app/invites",
      navigate,
      focus,
    };
    await focusOrOpen(
      { matchAll: async () => [client], openWindow },
      "/invites/6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
    );
    expect(navigate).toHaveBeenCalledWith(
      "/invites/6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
    );
    expect(focus).toHaveBeenCalled();
    await focusOrOpen(
      { matchAll: async () => [], openWindow },
      "/invites/6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
    );
    expect(openWindow).toHaveBeenCalledWith(
      "/invites/6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
    );
  });
});

describe("focusOrOpen never loses a tap or someone's work", () => {
  const url = "/invites/6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa";
  const window = (
    path: string,
    navigate: (url: string) => Promise<object | null>,
  ) => ({
    url: `https://tapnshow.vercel.app${path}`,
    navigate: vi.fn(navigate),
    focus: vi.fn<() => Promise<object>>(async () => ({})),
  });

  it("leaves other pages alone (an organizer's open meeting) and opens a new window", async () => {
    const editor = window("/w/club/meetings/1", async () => null);
    const openWindow = vi.fn<(url: string) => Promise<object | null>>(
      async () => null,
    );
    await focusOrOpen({ matchAll: async () => [editor], openWindow }, url);
    expect(editor.navigate).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith(url);
  });

  it("opens a new window when the open one can't be moved (not under this worker)", async () => {
    const stray = window("/invites", async () => {
      throw new TypeError("not controlled");
    });
    const openWindow = vi.fn<(url: string) => Promise<object | null>>(
      async () => null,
    );
    await focusOrOpen({ matchAll: async () => [stray], openWindow }, url);
    expect(openWindow).toHaveBeenCalledWith(url);
  });
});

describe("resubscribe (the browser replaced this device's subscription)", () => {
  const json = {
    endpoint: "https://fcm.googleapis.com/fcm/send/new",
    expirationTime: null,
    keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
  };
  const send = () =>
    vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => new Response("{}", { status: 200 }),
    );

  it("tells the server about the new one the browser made", async () => {
    const fetchMock = send();
    const subscribe =
      vi.fn<
        (
          options: PushSubscriptionOptionsInit,
        ) => Promise<{ toJSON: () => object }>
      >();
    await resubscribe(
      { oldSubscription: null, newSubscription: { toJSON: () => json } },
      { subscribe },
      fetchMock,
    );
    expect(subscribe).not.toHaveBeenCalled();
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/me/push-subscriptions");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(String(init.body))).toEqual({
      endpoint: json.endpoint,
      keys: json.keys,
    });
  });

  it("subscribes again with the old key when the browser made none", async () => {
    const fetchMock = send();
    const key = new Uint8Array(65).buffer;
    const subscribe = vi.fn<
      (
        options: PushSubscriptionOptionsInit,
      ) => Promise<{ toJSON: () => object }>
    >(async () => ({ toJSON: () => json }));
    await resubscribe(
      {
        oldSubscription: { options: { applicationServerKey: key } },
        newSubscription: null,
      },
      { subscribe },
      fetchMock,
    );
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does nothing without a key to subscribe with", async () => {
    const fetchMock = send();
    const subscribe =
      vi.fn<
        (
          options: PushSubscriptionOptionsInit,
        ) => Promise<{ toJSON: () => object }>
      >();
    await resubscribe(
      { oldSubscription: null, newSubscription: null },
      { subscribe },
      fetchMock,
    );
    expect(subscribe).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("forgetWhenSignedOut", () => {
  it("drops the saved invites when the server says the session is gone, and only then", async () => {
    const forget = vi.fn<() => Promise<void>>(async () => undefined);
    const plugin = forgetWhenSignedOut(forget);
    const ok = new Response("{}", { status: 200 });
    expect(await plugin.fetchDidSucceed({ response: ok })).toBe(ok);
    expect(forget).not.toHaveBeenCalled();
    const gone = new Response("{}", { status: 401 });
    expect(await plugin.fetchDidSucceed({ response: gone })).toBe(gone);
    expect(forget).toHaveBeenCalledOnce();
  });
});

describe("markSavedCopy", () => {
  const use = (cachedResponse?: Response) =>
    markSavedCopy().cachedResponseWillBeUsed({ cachedResponse });

  it("marks a list the worker answers from this device's copy", async () => {
    const copy = new Response(JSON.stringify({ items: [], asOf: "x" }), {
      headers: { "content-type": "application/json" },
    });
    const marked = await use(copy);
    expect(await marked?.json()).toEqual({ items: [], asOf: "x", saved: true });
    expect(marked?.headers.get("content-type")).toBe("application/json");
  });

  it("passes on no copy, or one that isn't a list, untouched", async () => {
    expect(await use(undefined)).toBeNull();
    const text = new Response("not json");
    expect(await use(text)).toBe(text);
  });
});
