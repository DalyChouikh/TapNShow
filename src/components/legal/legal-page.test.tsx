import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { LegalPage } from "./legal-page";

const document = {
  title: "Privacy Policy",
  updated: "2026-10-20",
  summary: ["a", "b", "c", "d", "e"],
  sections: [
    { id: "who", title: "Who we are", body: "TapNShow is run by…" },
    { id: "contact", title: "Contact", body: "Write to us." },
  ],
};

describe("LegalPage", () => {
  it("shows the date, the In short card, a jump list that matches the sections, numbered", () => {
    renderWithProviders(<LegalPage document={document} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Privacy Policy" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Last updated 20 October 2026"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "In short" }),
    ).toBeInTheDocument();
    const jump = screen.getByRole("navigation", { name: "On this page" });
    expect(
      Array.from(jump.querySelectorAll("a")).map((a) => a.getAttribute("href")),
    ).toEqual(["#who", "#contact"]);
    expect(
      screen.getByRole("heading", { level: 2, name: "1. Who we are" }),
    ).toHaveAttribute("id", "who");
    expect(screen.getByText(/not a lawyer's review/i)).toBeInTheDocument();
  });
});
