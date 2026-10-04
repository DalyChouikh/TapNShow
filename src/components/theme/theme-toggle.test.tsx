import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { ThemeToggle } from "./theme-toggle";

describe("ThemeToggle", () => {
  it("cycles system -> light -> dark -> system and updates its label", async () => {
    renderWithProviders(<ThemeToggle />);
    const button = await screen.findByRole("button", {
      name: /color theme: system/i,
    });
    await userEvent.click(button);
    expect(
      await screen.findByRole("button", { name: /color theme: light/i }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button"));
    expect(
      await screen.findByRole("button", { name: /color theme: dark/i }),
    ).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("dark");
    await userEvent.click(screen.getByRole("button"));
    expect(
      await screen.findByRole("button", { name: /color theme: system/i }),
    ).toBeInTheDocument();
  });
});
