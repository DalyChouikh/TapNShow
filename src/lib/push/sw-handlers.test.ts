import { describe, expect, it, vi } from "vitest";
import { focusOrOpen, notificationFromPush } from "./sw-handlers";

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
