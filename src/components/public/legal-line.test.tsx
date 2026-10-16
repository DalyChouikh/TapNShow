import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { LegalLine } from "./legal-line";

describe("LegalLine", () => {
  it("says who sent the page and links Privacy and Terms", () => {
    renderWithProviders(<LegalLine />);
    expect(screen.getByText(/Sent with TapNShow/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "href",
      "/terms",
    );
  });
});
