import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setWideViewport } from "@/test/match-media";
import { useMediaQuery } from "./use-media-query";

describe("useMediaQuery", () => {
  it("follows the media query", () => {
    expect(
      renderHook(() => useMediaQuery("(min-width: 768px)")).result.current,
    ).toBe(false);
    setWideViewport(true);
    expect(
      renderHook(() => useMediaQuery("(min-width: 768px)")).result.current,
    ).toBe(true);
  });
});
