import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("is hidden from assistive tech and stops pulsing for reduced motion", () => {
    const { container } = render(<Skeleton className="h-4" />);
    const block = container.firstElementChild;
    expect(block).toHaveAttribute("aria-hidden", "true");
    expect(block?.className).toContain("motion-reduce:animate-none");
    expect(block?.className).toContain("h-4");
  });
});
