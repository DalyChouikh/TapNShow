import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import HomePage from "./page";

describe("HomePage", () => {
  it("renders the translated product name heading", () => {
    renderWithProviders(<HomePage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "TapNShow",
    );
  });
});
