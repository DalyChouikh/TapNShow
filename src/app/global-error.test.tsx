import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import GlobalError from "./global-error";

const { captureClientError } = vi.hoisted(() => ({
  captureClientError: vi.fn(),
}));
vi.mock("@/lib/observability/browser-sentry", () => ({ captureClientError }));

describe("GlobalError", () => {
  it("shows the Errors messages and reports the error", () => {
    const error = new Error("boom");
    render(<GlobalError error={error} retry={vi.fn()} />, {
      container: document,
    });
    expect(screen.getByText(messages.Errors.global)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: messages.Errors.retry }),
    ).toBeInTheDocument();
    expect(captureClientError).toHaveBeenCalledExactlyOnceWith(error);
  });

  it("doesn't bundle the message catalogue (it loads on every page)", () => {
    const source = readFileSync("src/app/global-error.tsx", "utf8");
    expect(source).not.toMatch(/from "[^"]*messages\/en\.json"/);
  });

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
