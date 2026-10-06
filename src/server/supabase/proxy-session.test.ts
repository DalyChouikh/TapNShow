import { describe, expect, it } from "vitest";
import { requiresSession } from "./proxy-session";

describe("requiresSession", () => {
  it.each([
    ["/welcome", true],
    ["/w/new", true],
    ["/w/club-ab12/settings", true],
    ["/login", false],
    ["/invite/abc", false],
    ["/", false],
    ["/design", false],
    ["/api/me", false],
    ["/wiki", false],
  ])("%s → %s", (path, expected) => {
    expect(requiresSession(path)).toBe(expected);
  });
});
