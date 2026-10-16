import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { SuspendedBanner } from "./suspended-banner";

describe("SuspendedBanner", () => {
  it("says sending is paused in plain words and how to reach us", () => {
    renderWithProviders(<SuspendedBanner contact="mailto:team@example.test" />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Sending is paused.");
    expect(banner).toHaveTextContent("nothing is deleted");
    expect(banner).not.toHaveTextContent(/suspen|report rate|token/i);
    expect(screen.getByRole("link", { name: "Contact us" })).toHaveAttribute(
      "href",
      "mailto:team@example.test",
    );
  });
});
