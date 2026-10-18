import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./use-now";

afterEach(() => vi.useRealTimers());

describe("useNow", () => {
  it("gives the current time and refreshes it every interval", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T10:00:00Z"));
    const { result } = renderHook(() => useNow(60_000));
    expect(result.current.toISOString()).toBe("2026-10-18T10:00:00.000Z");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.toISOString()).toBe("2026-10-18T10:01:00.000Z");
  });

  it("stops refreshing once unmounted", () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useNow(60_000));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
