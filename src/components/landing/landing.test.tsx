import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { FinalCall } from "./final-call";
import { Features } from "./features";
import { HowItWorks } from "./how-it-works";
import { LandingFaq } from "./landing-faq";
import { LandingHero } from "./landing-hero";
import { PrivacyStrip } from "./privacy-strip";

describe("landing sections", () => {
  it("hero: the promise, Get started to sign-in, See how to the steps, the invite preview", () => {
    renderWithProviders(<LandingHero />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Know who's coming",
    );
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(
      screen.getByRole("link", { name: "See how it works" }),
    ).toHaveAttribute("href", "#how-it-works");
    const preview = screen.getByRole("figure", {
      name: "An invite as members see it",
    });
    expect(preview).toHaveTextContent("I'm going");
    expect(preview).toHaveTextContent("I'll be late");
    expect(preview).toHaveTextContent("I can't come");
  });

  it("three steps, six features, the privacy promise, the final call", () => {
    renderWithProviders(
      <>
        <HowItWorks />
        <Features />
        <PrivacyStrip />
        <FinalCall />
      </>,
    );
    expect(
      screen.getByRole("heading", { name: "How it works" }).closest("section"),
    ).toHaveAttribute("id", "how-it-works");
    expect(screen.getAllByRole("listitem")).toHaveLength(3 + 6);
    expect(
      screen.getByRole("heading", { name: "We send email. We never read it." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("FAQ answers open one at a time", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LandingFaq />);
    const free = screen.getByRole("button", { name: "Is it free?" });
    expect(free).toHaveAttribute("aria-expanded", "false");
    await user.click(free);
    expect(free).toHaveAttribute("aria-expanded", "true");
    await user.click(
      screen.getByRole("button", { name: "Who sees the answers?" }),
    );
    expect(free).toHaveAttribute("aria-expanded", "false");
  });
});
