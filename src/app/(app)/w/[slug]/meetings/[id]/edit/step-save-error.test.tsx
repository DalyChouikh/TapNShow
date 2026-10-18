import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api-client";
import { renderWithProviders } from "@/test/render";
import { StepSaveError } from "./step-save-error";

describe("StepSaveError", () => {
  it("shows nothing while nothing failed", () => {
    renderWithProviders(<StepSaveError error={null} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names the reason when the server refused the save", () => {
    renderWithProviders(
      <StepSaveError error={new ApiClientError("late_too_long", 409)} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A late time must be shorter than the meeting.",
    );
  });

  it("asks to retry when the save didn't get through", () => {
    renderWithProviders(<StepSaveError error={new Error("network")} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't save. Check your connection and try again.",
    );
  });
});
