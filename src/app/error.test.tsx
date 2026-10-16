import { readFileSync } from "node:fs";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import ErrorPage from "./error";

const { captureClientError } = vi.hoisted(() => ({
  captureClientError: vi.fn(),
}));
vi.mock("@/lib/observability/browser-sentry", () => ({ captureClientError }));

describe("ErrorPage", () => {
  it("reports the error once and shows no technical details", async () => {
    const error = Object.assign(new Error("db password=hunter2 failed"), {
      digest: "123",
    });
    renderWithProviders(<ErrorPage error={error} retry={vi.fn()} />);
    expect(captureClientError).toHaveBeenCalledExactlyOnceWith(error);
    expect(
      // The view loads lazily; its first import in a test run is a cold transform.
      await screen.findByRole(
        "heading",
        { name: "Something went wrong" },
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/hunter2|123/)).toBeNull();
  });

  it("tries again with retry()", async () => {
    const retry = vi.fn();
    renderWithProviders(<ErrorPage error={new Error("x")} retry={retry} />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("link", { name: "Go to the home page" }),
    ).toHaveAttribute("href", "/");
  });

  it("loads its view only when a page crashes (not with every page's first scripts)", () => {
    const source = readFileSync("src/app/error.tsx", "utf8");
    expect(source).not.toMatch(
      /^import [^;]*from "@\/components\/errors\/error-view";/m,
    );
    expect(source).toMatch(/import\("@\/components\/errors\/error-view"\)/);
  });
});
