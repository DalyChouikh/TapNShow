import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { GoogleButton } from "./google-button";

describe("GoogleButton", () => {
  it("is a link with Google's approved wording and a decorative logo", () => {
    renderWithProviders(<GoogleButton href="/api/auth/google/start" />);
    const link = screen.getByRole("link", { name: "Continue with Google" });
    expect(link).toHaveAttribute("href", "/api/auth/google/start");
    expect(link.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("keeps Google's mandated fill, stroke and logo size", () => {
    renderWithProviders(<GoogleButton href="/api/auth/google/start" />);
    const link = screen.getByRole("link", { name: "Continue with Google" });
    for (const required of [
      "bg-[#FFFFFF]",
      "border-[#747775]",
      "text-[#1F1F1F]",
      "dark:bg-[#131314]",
      "dark:border-[#8E918F]",
      "dark:text-[#E3E3E3]",
    ]) {
      expect(link.className).toContain(required);
    }
    expect(link.querySelector("img")).toHaveAttribute("width", "20");
  });

  it("presses like the app's Neobrutalist buttons, without motion for reduced-motion users", () => {
    renderWithProviders(<GoogleButton href="/api/auth/google/start" />);
    const link = screen.getByRole("link", { name: "Continue with Google" });
    for (const style of [
      "rounded-control",
      "min-h-12",
      "shadow-brutal",
      "hover:-translate-y-0.5",
      "hover:shadow-brutal-lg",
      "active:translate-y-1",
      "active:shadow-none",
      "motion-reduce:transition-none",
      "motion-reduce:hover:translate-y-0",
    ]) {
      expect(link.className).toContain(style);
    }
  });
});
