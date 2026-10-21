import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { DEVICE_KEYS } from "@/config/members";
import {
  clearDeviceValues,
  readDeviceValue,
  scopedDeviceKey,
  writeDeviceValue,
} from "./storage";

beforeEach(() => window.localStorage.clear());

describe("device storage", () => {
  it("reads back what was written and ignores a value that fails the schema", () => {
    writeDeviceValue(DEVICE_KEYS.invitesFilter, "needs");
    expect(
      readDeviceValue(DEVICE_KEYS.invitesFilter, z.enum(["all", "needs"])),
    ).toBe("needs");
    window.localStorage.setItem(DEVICE_KEYS.invitesFilter, "bogus");
    expect(
      readDeviceValue(DEVICE_KEYS.invitesFilter, z.enum(["all", "needs"])),
    ).toBeNull();
  });

  it("clears only TapNShow's own keys", () => {
    writeDeviceValue(DEVICE_KEYS.invitesFilter, "needs");
    window.localStorage.setItem("theme", "dark");
    clearDeviceValues();
    expect(window.localStorage.getItem(DEVICE_KEYS.invitesFilter)).toBeNull();
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });

  it("keeps a value per workspace, and clears it with the rest at sign-out (#417)", () => {
    const a = scopedDeviceKey(DEVICE_KEYS.sheetsTipHiddenUntil, "workspace-a");
    const b = scopedDeviceKey(DEVICE_KEYS.sheetsTipHiddenUntil, "workspace-b");
    writeDeviceValue(a, "2026-11-01T00:00:00.000Z");
    expect(readDeviceValue(b, z.string())).toBeNull();
    clearDeviceValues();
    expect(window.localStorage.getItem(a)).toBeNull();
  });
});
