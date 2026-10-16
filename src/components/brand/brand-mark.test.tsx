import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { appIconSvg } from "@/lib/brand/app-icon";
import { BrandMark } from "./brand-mark";

describe("BrandMark", () => {
  it("draws the app icon inline (no image request), hidden from screen readers", () => {
    const { container } = render(<BrandMark />);
    const mark = container.firstElementChild;
    expect(mark).toHaveAttribute("aria-hidden", "true");
    // The drawing the icon files come from, serialized the way the DOM serializes it.
    const expected = document.createElement("div");
    expected.innerHTML = appIconSvg("full");
    expect(mark?.innerHTML).toBe(expected.innerHTML);
    expect(container.querySelector("img")).toBeNull();
  });

  it("is 32 px unless told otherwise", () => {
    const { container, rerender } = render(<BrandMark />);
    expect(container.firstElementChild).toHaveClass("size-8");
    rerender(<BrandMark className="size-12" />);
    expect(container.firstElementChild).toHaveClass("size-12");
    expect(container.firstElementChild).not.toHaveClass("size-8");
  });
});
