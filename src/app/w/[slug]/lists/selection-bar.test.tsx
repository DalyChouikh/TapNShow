import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { IDS, rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { SelectionBar } from "./selection-bar";

const base = "/api/workspaces/club-ab12";

describe("SelectionBar", () => {
  it("adds the selection to a list and clears it", async () => {
    const fetchMock = routeFetch({
      [`POST ${base}/contacts/bulk`]: json({ affected: 2 }),
      [`GET ${base}/contacts`]: json(rosterFixture),
    });
    const onClear = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <SelectionBar
        slug="club-ab12"
        roster={rosterFixture}
        selectedIds={new Set([IDS.ines, IDS.youssef])}
        onClear={onClear}
        onDelete={vi.fn()}
      />,
      { toaster: true },
    );
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    await user.click(screen.getByRole("option", { name: "Design" }));
    expect(
      await screen.findByText("2 people added to Design."),
    ).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      action: "addToList",
      contactIds: [IDS.ines, IDS.youssef],
      listId: IDS.design,
    });
    expect(onClear).toHaveBeenCalled();
  });

  it("names a list created from the picker in the result", async () => {
    const created = "00000000-0000-4000-8000-0000000000d9";
    routeFetch({
      [`POST ${base}/lists`]: json({ id: created, name: "Alumni" }),
      [`POST ${base}/contacts/bulk`]: json({ affected: 2 }),
      [`GET ${base}/contacts`]: json(rosterFixture),
    });
    const user = userEvent.setup();
    renderWithProviders(
      <SelectionBar
        slug="club-ab12"
        roster={rosterFixture}
        selectedIds={new Set([IDS.ines, IDS.youssef])}
        onClear={vi.fn()}
        onDelete={vi.fn()}
      />,
      { toaster: true },
    );
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    await user.type(
      screen.getByPlaceholderText("Search or create a list"),
      "Alumni",
    );
    await user.click(
      screen.getByRole("option", { name: 'Create list "Alumni"' }),
    );
    expect(
      await screen.findByText("2 people added to Alumni."),
    ).toBeInTheDocument();
  });

  it("offers only the selection's lists for removal, and hands confirmed deletes to Undo", async () => {
    const fetchMock = routeFetch({});
    const onDelete = vi.fn();
    const onClear = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <SelectionBar
        slug="club-ab12"
        roster={rosterFixture}
        selectedIds={new Set([IDS.ines])}
        onClear={onClear}
        onDelete={onDelete}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Remove from list" }));
    expect(screen.getByRole("option", { name: "Dev" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Design" })).toBeNull();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Delete 1" }));
    expect(
      screen.getByRole("heading", { name: "Delete 1 person?" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith([IDS.ines]);
    expect(onClear).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
