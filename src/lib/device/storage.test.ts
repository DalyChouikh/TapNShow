import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { DEVICE_KEYS } from "@/config/members";
import {
  clearDeviceValues,
  readDeviceValue,
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
});
