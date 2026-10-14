import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEVICE_KEYS } from "@/config/members";
import { clearDeviceData } from "./clear";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("clearDeviceData", () => {
  it("deletes TapNShow's caches and saved values, and nothing else", async () => {
    const remove = vi.fn<(name: string) => Promise<boolean>>(async () => true);
    vi.stubGlobal("caches", {
      keys: async () => ["tn-pages", "tn-invites", "other"],
      delete: remove,
    });
    window.localStorage.setItem(DEVICE_KEYS.invitesFilter, "needs");
    window.localStorage.setItem("theme", "dark");
    await clearDeviceData();
    expect(remove.mock.calls.map(([name]) => name)).toEqual([
      "tn-pages",
      "tn-invites",
    ]);
    expect(window.localStorage.getItem(DEVICE_KEYS.invitesFilter)).toBeNull();
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });

  it("still clears saved values where the browser has no Cache Storage or refuses it", async () => {
    window.localStorage.setItem(DEVICE_KEYS.invitesFilter, "needs");
    vi.stubGlobal("caches", {
      keys: async () => Promise.reject(new Error("SecurityError")),
      delete: vi.fn(),
    });
    await expect(clearDeviceData()).resolves.toBeUndefined();
    expect(window.localStorage.getItem(DEVICE_KEYS.invitesFilter)).toBeNull();
  });
});
