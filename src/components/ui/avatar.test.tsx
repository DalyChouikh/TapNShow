import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar, initialsFor } from "./avatar";

describe("Avatar", () => {
  it("uses up to two initials, else the email's first letter", () => {
    expect(initialsFor("Amira Ben Ali", null)).toBe("AB");
    expect(initialsFor(null, "sami@example.test")).toBe("S");
  });

  it("is decorative", () => {
    render(<Avatar name="Amira" email={null} />);
    expect(screen.getByText("A")).toHaveAttribute("aria-hidden", "true");
  });
});
