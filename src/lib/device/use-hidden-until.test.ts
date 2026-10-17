import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DEVICE_KEYS } from "@/config/members";
import { useHiddenUntil } from "./use-hidden-until";

const KEY = DEVICE_KEYS.sheetsTipHiddenUntil;
const NOW = new Date("2026-10-17T10:00:00.000Z");

beforeEach(() => localStorage.clear());

describe("useHiddenUntil", () => {
  it("is hidden until the stored instant and shown after it", () => {
    localStorage.setItem(KEY, "2026-10-20T10:00:00.000Z");
    const before = renderHook(() => useHiddenUntil(KEY, 30, NOW));
    expect(before.result.current.hidden).toBe(true);
    const after = renderHook(() =>
      useHiddenUntil(KEY, 30, new Date("2026-10-20T10:00:00.001Z")),
    );
    expect(after.result.current.hidden).toBe(false);
  });

  it("treats a missing or invalid stored value as not hidden", () => {
    expect(
      renderHook(() => useHiddenUntil(KEY, 30, NOW)).result.current.hidden,
    ).toBe(false);
    localStorage.setItem(KEY, "soon");
    expect(
      renderHook(() => useHiddenUntil(KEY, 30, NOW)).result.current.hidden,
    ).toBe(false);
  });

  it("hides at once and remembers it on this device for the given days", () => {
    const { result } = renderHook(() => useHiddenUntil(KEY, 30, NOW));
    act(() => result.current.hide());
    expect(result.current.hidden).toBe(true);
    expect(localStorage.getItem(KEY)).toBe("2026-11-16T10:00:00.000Z");
  });
});
