import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GlobalError from "./global-error";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

describe("GlobalError", () => {
  it("offers a retry that calls retry", () => {
    const retry = vi.fn();
    // It renders its own <html>, so it mounts on the document like Next mounts it.
    render(<GlobalError error={new Error("boom")} retry={retry} />, {
      container: document,
    });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("styles itself without the app stylesheet, in light and dark", () => {
    render(<GlobalError error={new Error("boom")} retry={vi.fn()} />, {
      container: document,
    });
    const css = Array.from(document.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .join("\n");
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain("#16131F");
  });
});
