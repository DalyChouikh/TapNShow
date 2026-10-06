import { describe, expect, it } from "vitest";
import { browserTimezone, listTimezones } from "./timezones";

describe("timezones", () => {
  it("lists IANA names including Africa/Tunis, sorted", () => {
    const zones = listTimezones();
    expect(zones).toContain("Africa/Tunis");
    expect([...zones].sort()).toEqual(zones);
  });

  it("detects the browser timezone", () => {
    expect(browserTimezone()).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });
});
