import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./card";

describe("Card", () => {
  it("renders as a div by default and as the requested element", () => {
    const { rerender } = render(<Card>Body</Card>);
    expect(screen.getByText("Body").tagName).toBe("DIV");
    rerender(
      <Card as="section" aria-label="Meeting">
        Body
      </Card>,
    );
    expect(screen.getByRole("region", { name: "Meeting" })).toBeInTheDocument();
  });
});
