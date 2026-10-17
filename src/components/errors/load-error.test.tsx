import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { LoadError } from "./load-error";

describe("LoadError", () => {
  it("says the part didn't load and tries again on tap", async () => {
    const onRetry = vi.fn<() => void>();
    renderWithProviders(<LoadError onRetry={onRetry} />);
    expect(screen.getByText("Couldn't load this.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("can name what didn't load", () => {
    renderWithProviders(
      <LoadError message="We couldn't load your roster." onRetry={() => {}} />,
    );
    expect(
      screen.getByText("We couldn't load your roster."),
    ).toBeInTheDocument();
  });

  it("can sit inside a card without a frame of its own", () => {
    const { container } = renderWithProviders(
      <LoadError bare onRetry={() => {}} />,
    );
    expect(container.querySelector("section")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});
