import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Pill } from "./pill";

describe("Pill", () => {
  it("labels a status in its tone's fill", () => {
    render(<Pill tone="warning">Not answered</Pill>);
    expect(screen.getByText("Not answered")).toHaveClass("bg-fill-warning");
  });

  it("takes the same fill as a pressed chip of that tone", () => {
    render(<Pill tone="success">Going</Pill>);
    expect(screen.getByText("Going")).toHaveClass("bg-fill-success");
  });
});
