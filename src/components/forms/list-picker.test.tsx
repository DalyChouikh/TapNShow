import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IDS, rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { ListPicker } from "./list-picker";

describe("ListPicker", () => {
  it("toggles lists in multiple mode", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ListPicker
        lists={rosterFixture.lists}
        selectedIds={[IDS.dev]}
        onChange={onChange}
        triggerLabel="Add to a list"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add to a list" }));
    await user.click(screen.getByRole("option", { name: "Design" }));
    expect(onChange).toHaveBeenLastCalledWith([IDS.dev, IDS.design]);
    await user.click(screen.getByRole("option", { name: "Dev" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("creates a list from the search text, ignoring case for existing names", async () => {
    const onChange = vi.fn();
    const onCreate = vi.fn(async () => ({
      id: "00000000-0000-4000-8000-0000000000d9",
    }));
    const user = userEvent.setup();
    renderWithProviders(
      <ListPicker
        lists={rosterFixture.lists}
        selectedIds={[]}
        onChange={onChange}
        onCreate={onCreate}
        triggerLabel="Add to a list"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add to a list" }));
    await user.type(
      screen.getByPlaceholderText("Search or create a list"),
      "dev",
    );
    expect(screen.queryByRole("option", { name: /Create list/ })).toBeNull();
    await user.clear(screen.getByPlaceholderText("Search or create a list"));
    await user.type(
      screen.getByPlaceholderText("Search or create a list"),
      "  Media ",
    );
    await user.click(
      screen.getByRole("option", { name: 'Create list "Media"' }),
    );
    expect(onCreate).toHaveBeenCalledWith("Media");
    expect(onChange).toHaveBeenLastCalledWith([
      "00000000-0000-4000-8000-0000000000d9",
    ]);
  });

  it("selects one list and closes in single mode", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ListPicker
        mode="single"
        lists={rosterFixture.lists}
        selectedIds={[]}
        onChange={onChange}
        triggerLabel="Choose a list"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Choose a list" }));
    await user.click(screen.getByRole("option", { name: "Design" }));
    expect(onChange).toHaveBeenCalledWith([IDS.design]);
    expect(screen.queryByRole("option", { name: "Design" })).toBeNull();
  });
});
