import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { PublicFooter } from "./public-footer";

describe("PublicFooter", () => {
  it("links Privacy, Terms and Contact and names the maker", () => {
    renderWithProviders(<PublicFooter contact="mailto:team@example.com" />);
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
      "mailto:team@example.com",
    );
    expect(screen.getByText("Made by Mohamed Ali Chouikh")).toBeInTheDocument();
  });
});
