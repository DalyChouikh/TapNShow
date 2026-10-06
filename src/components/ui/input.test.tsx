import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./input";

describe("Input", () => {
  it("is labelled", () => {
    render(<Input id="reason" label="Reason for delay" />);
    expect(screen.getByLabelText("Reason for delay")).toBeInTheDocument();
  });

  it("links the hint", () => {
    render(<Input id="reason" label="Reason" hint="Visible to organizers" />);
    expect(screen.getByLabelText("Reason")).toHaveAccessibleDescription(
      "Visible to organizers",
    );
  });

  it("marks errors as invalid and describes them", () => {
    render(<Input id="reason" label="Reason" error="Please enter a reason" />);
    const input = screen.getByLabelText("Reason");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Please enter a reason");
  });

  it("can hide its label visually while keeping the accessible name", () => {
    render(<Input id="q" label="Search people" hideLabel type="search" />);
    expect(
      screen.getByRole("searchbox", { name: "Search people" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Search people")).toHaveClass("sr-only");
  });
});
