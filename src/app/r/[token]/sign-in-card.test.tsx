import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { SignInCard } from "./sign-in-card";

vi.mock("@/lib/device/kind", () => ({ useDeviceKind: () => "phone" }));

describe("SignInCard (spec §7.4 discovery)", () => {
  it("invites the person to sign in for reminders and every invite in one place", () => {
    renderWithProviders(<SignInCard />);
    expect(screen.getByText("Get reminders on this phone")).toBeVisible();
    expect(
      screen.getByText(
        "Sign in with the email this invite came to, to see all your invites in one place.",
      ),
    ).toBeVisible();
    const link = screen.getByRole("link", { name: "Sign in" });
    // Never the address: a forwarded link must not reveal whose invite it is.
    expect(link).toHaveAttribute("href", "/login?next=%2Finvites");
  });
});
