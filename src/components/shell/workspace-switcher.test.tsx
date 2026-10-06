import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { meFixture, workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { WorkspaceSwitcher } from "./workspace-switcher";

describe("WorkspaceSwitcher", () => {
  it("shows the current workspace and role, and lists all workspaces plus Create", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <WorkspaceSwitcher me={meFixture} current={workspaceFixture} />,
    );
    const trigger = screen.getByRole("button", { name: "Switch workspace" });
    expect(trigger).toHaveTextContent("Robotics Club");
    expect(trigger).toHaveTextContent("Owner");
    await user.click(trigger);
    expect(
      screen.getByRole("menuitem", { name: /Chess Club/ }),
    ).toHaveAttribute("href", "/w/chess-ab12");
    expect(
      screen.getByRole("menuitem", { name: /Robotics Club/ }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("menuitem", { name: "Create workspace" }),
    ).toHaveAttribute("href", "/w/new");
  });
});
