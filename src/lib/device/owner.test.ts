import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEVICE_KEYS } from "@/config/members";
import { claimDevice, markDeviceOwner } from "./owner";

const device = vi.hoisted(() => ({
  clear: vi.fn<() => Promise<void>>(async () => undefined),
}));
vi.mock("./clear", () => ({ clearDeviceData: device.clear }));

const A = "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa";
const B = "7b2f3c4d-5e6f-4a71-8b82-c3d4e5f6a7bb";

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("claimDevice (sign-in)", () => {
  it("wipes another person's data, then marks the device as this person's", async () => {
    window.localStorage.setItem(DEVICE_KEYS.owner, A);
    await claimDevice(B);
    expect(device.clear).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(DEVICE_KEYS.owner)).toBe(B);
  });

  it("keeps the same person's data", async () => {
    window.localStorage.setItem(DEVICE_KEYS.owner, A);
    await claimDevice(A);
    expect(device.clear).not.toHaveBeenCalled();
  });
});

describe("markDeviceOwner (saving something on this device)", () => {
  it("marks an unmarked device, so this person's next sign-in keeps their reminders", () => {
    markDeviceOwner(A);
    expect(window.localStorage.getItem(DEVICE_KEYS.owner)).toBe(A);
  });

  it("never re-marks a device that is someone's already", () => {
    window.localStorage.setItem(DEVICE_KEYS.owner, A);
    markDeviceOwner(B);
    expect(window.localStorage.getItem(DEVICE_KEYS.owner)).toBe(A);
  });
});
