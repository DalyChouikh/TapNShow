import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { NotFoundView } from "./not-found-view";

describe("NotFoundView", () => {
  it("offers the home page to everyone", () => {
    renderWithProviders(<NotFoundView signedIn={false} />);
    expect(
      screen.getByRole("heading", { name: "We can't find that page" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to the home page" }),
    ).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "Open TapNShow" })).toBeNull();
  });

  it("offers the app first to someone signed in", () => {
    renderWithProviders(<NotFoundView signedIn />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Open TapNShow",
      "Go to the home page",
    ]);
    expect(links[0]).toHaveAttribute("href", "/welcome");
  });
});
