import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { LegalNav } from "./legal-nav";

describe("LegalNav", () => {
  it("links Privacy, Terms and Contact (the footer and /account)", () => {
    renderWithProviders(<LegalNav contact="mailto:team@example.test" />);
    const nav = screen.getByRole("navigation", { name: "TapNShow links" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(screen.getByRole("link", { name: "Contact" })).toHaveAttribute(
      "href",
      "mailto:team@example.test",
    );
  });
});
