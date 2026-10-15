import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { renderWithProviders } from "@/test/render";
import { ThemeMenuChoice } from "./theme-menu-choice";

describe("ThemeMenuChoice", () => {
  it("offers System, Light and Dark as radio items and keeps the menu open on a choice", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <ThemeMenuChoice />
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual([
      "System",
      "Light",
      "Dark",
    ]);
    expect(items[0]).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitemradio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
  });
});
