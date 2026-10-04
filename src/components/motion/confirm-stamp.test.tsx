import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setReducedMotion } from "@/test/match-media";
import { renderWithProviders } from "@/test/render";
import { ConfirmStamp } from "./confirm-stamp";

describe("ConfirmStamp", () => {
  it("renders the stamp with confetti when motion is allowed", () => {
    renderWithProviders(<ConfirmStamp label="Confirmed" show />);
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getAllByTestId("confetti-piece")).toHaveLength(6);
  });

  it("renders the stamp instantly without confetti for reduced-motion users", () => {
    setReducedMotion(true);
    renderWithProviders(<ConfirmStamp label="Confirmed" show />);
    expect(screen.getByText("Confirmed")).toBeVisible();
    expect(screen.queryAllByTestId("confetti-piece")).toHaveLength(0);
  });

  it("renders nothing when hidden", () => {
    renderWithProviders(<ConfirmStamp label="Confirmed" show={false} />);
    expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
  });
});
