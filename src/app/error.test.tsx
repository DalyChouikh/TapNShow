import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import ErrorPage from "./error";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

describe("ErrorPage", () => {
  it("reports the error once and shows no technical details", () => {
    const error = Object.assign(new Error("db password=hunter2 failed"), {
      digest: "123",
    });
    renderWithProviders(<ErrorPage error={error} retry={vi.fn()} />);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error);
    expect(
      screen.getByRole("heading", { name: "Something went wrong" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/hunter2|123/)).toBeNull();
  });

  it("tries again with retry()", () => {
    const retry = vi.fn();
    renderWithProviders(<ErrorPage error={new Error("x")} retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("link", { name: "Go to the home page" }),
    ).toHaveAttribute("href", "/");
  });
});
