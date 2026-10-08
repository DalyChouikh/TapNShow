import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { DesignShowcase } from "./design-showcase";

describe("DesignShowcase response demo", () => {
  it("shows delay chips after choosing late", async () => {
    renderWithProviders(<DesignShowcase />);
    expect(
      screen.queryByRole("button", { name: "10-20 min" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /I'll be late/ }));
    expect(screen.getByRole("button", { name: "10-20 min" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("stamps CONFIRMED after choosing attend", async () => {
    renderWithProviders(<DesignShowcase />);
    await userEvent.click(
      screen.getByRole("button", { name: /I'll be there/ }),
    );
    expect(screen.getByText("CONFIRMED")).toBeInTheDocument();
  });

  it("shows the styled form controls", () => {
    renderWithProviders(<DesignShowcase />);
    expect(
      screen.getByRole("region", { name: "Controls" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Include alumni" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "First row is headers" }),
    ).toBeChecked();
    expect(
      screen.getByRole("radiogroup", { name: "Source" }),
    ).toBeInTheDocument();
  });

  it("shows the M4 primitives", () => {
    renderWithProviders(<DesignShowcase />);
    for (const name of ["Date and time", "Markdown editor", "Confirm dialog"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
  });
});
