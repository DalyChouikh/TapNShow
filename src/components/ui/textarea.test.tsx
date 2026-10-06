import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { Textarea } from "./textarea";

describe("Textarea", () => {
  it("wires label, hint and error like Input", () => {
    renderWithProviders(
      <Textarea
        id="paste"
        label="Paste rows"
        hint="From Google Sheets"
        error="Nothing to import"
      />,
    );
    const field = screen.getByLabelText("Paste rows");
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(
      "From Google Sheets Nothing to import",
    );
    expect(field.className).toContain("shadow-brutal-sm");
  });
});
