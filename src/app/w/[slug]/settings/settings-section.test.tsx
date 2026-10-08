import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { SettingsSection } from "./settings-section";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("SettingsSection", () => {
  it("starts collapsed and opens from its heading button", async () => {
    renderWithProviders(
      <SettingsSection id="sending" title="Sending" defaultOpen={false}>
        <p>Body</p>
      </SettingsSection>,
    );
    const toggle = screen.getByRole("button", { name: "Sending" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Body")).toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: "Sending" }),
    ).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("opens when the URL points at it", () => {
    window.history.replaceState(null, "", "/w/x/settings#people");
    renderWithProviders(
      <SettingsSection id="people" title="People" defaultOpen={false}>
        <p>Members</p>
      </SettingsSection>,
    );
    expect(screen.getByText("Members")).toBeInTheDocument();
  });
});
