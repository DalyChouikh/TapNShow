import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api-client";
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

  it("offers to create a list even when there are no lists yet", async () => {
    const onCreate = vi.fn(async () => ({
      id: "00000000-0000-4000-8000-0000000000d9",
    }));
    const user = userEvent.setup();
    renderWithProviders(
      <ListPicker
        lists={[]}
        selectedIds={[]}
        onChange={vi.fn()}
        onCreate={onCreate}
        triggerLabel="Add to a list"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add to a list" }));
    await user.type(
      screen.getByPlaceholderText("Search or create a list"),
      "Alumni",
    );
    expect(
      screen.getByRole("option", { name: 'Create list "Alumni"' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No list matches/)).toBeNull();
  });

  it("does not promise creation when the picker cannot create lists", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ListPicker
        lists={[]}
        selectedIds={[]}
        onChange={vi.fn()}
        triggerLabel="Choose a list"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Choose a list" }));
    await user.type(screen.getByPlaceholderText("Search lists"), "Alumni");
    expect(screen.getByText("No list matches.")).toBeInTheDocument();
    expect(screen.queryByText(/create one/)).toBeNull();
  });

  it("says why a list could not be created", async () => {
    const onChange = vi.fn();
    const onCreate = vi.fn(async () => {
      throw new ApiClientError("lists_limit_reached", 409);
    });
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
      "Media",
    );
    await user.click(
      screen.getByRole("option", { name: 'Create list "Media"' }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You have the maximum number of lists. Delete one first.",
    );
    expect(onChange).not.toHaveBeenCalled();
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

  it("keeps the highlighted option off the popover's edges", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ListPicker
        lists={rosterFixture.lists}
        selectedIds={[]}
        onChange={vi.fn()}
        triggerLabel="Add to a list"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add to a list" }));
    const panel = screen.getByRole("dialog");
    expect(panel).toHaveClass("p-1.5");
    expect(panel).not.toHaveClass("p-0");
  });
});
