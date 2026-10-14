import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEVICE_KEYS } from "@/config/members";
import { clearDeviceData } from "./clear";

const reminders = vi.hoisted(() => ({
  steps: [] as string[],
  turnOff: vi.fn<() => Promise<void>>(),
}));
vi.mock("@/lib/push/client", () => ({ turnOffReminders: reminders.turnOff }));

beforeEach(() => {
  window.localStorage.clear();
  reminders.steps = [];
  reminders.turnOff.mockImplementation(async () => {
    reminders.steps.push("reminders off");
  });
});
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

  it("turns this device's reminders off first (the server call needs the session)", async () => {
    vi.stubGlobal("caches", {
      keys: async () => {
        reminders.steps.push("caches");
        return [];
      },
      delete: vi.fn(),
    });
    await clearDeviceData();
    expect(reminders.steps).toEqual(["reminders off", "caches"]);
  });

  it("still clears caches and saved values when turning reminders off fails", async () => {
    reminders.turnOff.mockRejectedValueOnce(new Error("no service worker"));
    const remove = vi.fn<(name: string) => Promise<boolean>>(async () => true);
    vi.stubGlobal("caches", { keys: async () => ["tn-pages"], delete: remove });
    window.localStorage.setItem(DEVICE_KEYS.invitesFilter, "needs");
    await clearDeviceData();
    expect(remove).toHaveBeenCalledWith("tn-pages");
    expect(window.localStorage.getItem(DEVICE_KEYS.invitesFilter)).toBeNull();
  });
});
