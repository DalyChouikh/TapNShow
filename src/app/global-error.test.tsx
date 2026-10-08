import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GlobalError from "./global-error";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

describe("GlobalError", () => {
  it("offers a retry that calls reset", () => {
    const reset = vi.fn();
    render(<GlobalError error={new Error("boom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("styles itself without the app stylesheet, in light and dark", () => {
    render(<GlobalError error={new Error("boom")} reset={vi.fn()} />);
    const css = Array.from(document.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .join("\n");
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain("#16131F");
  });
});
