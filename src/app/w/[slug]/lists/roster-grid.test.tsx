import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { IDS, rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { RosterGrid } from "./roster-grid";

function renderGrid(
  selectedIds = new Set<string>(),
  onToggle = vi.fn(),
  canEdit = true,
  onOpen = vi.fn(),
) {
  renderWithProviders(
    <RosterGrid
      slug="club-ab12"
      contacts={rosterFixture.contacts}
      roster={rosterFixture}
      canEdit={canEdit}
      selectedIds={selectedIds}
      onToggle={onToggle}
      onToggleAll={vi.fn()}
      onOpen={onOpen}
    />,
  );
  return onToggle;
}

describe("RosterGrid", () => {
  it("is a table of people with their lists", () => {
    renderGrid();
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(expect.arrayContaining(["Full name", "Email", "Lists"]));
    expect(within(table).getAllByRole("row")).toHaveLength(4);
  });

  it("edits a name in place and saves it", async () => {
    const fetchMock = routeFetch({
      [`PATCH /api/workspaces/club-ab12/contacts/${IDS.ines}`]: json({
        ok: true,
      }),
      "GET /api/workspaces/club-ab12/contacts": json(rosterFixture),
    });
    const user = userEvent.setup();
    renderGrid();
    await user.click(
      screen.getByRole("button", { name: "Full name of Inès Ben Salah" }),
    );
    const field = screen.getByRole("textbox", {
      name: "Full name of Inès Ben Salah",
    });
    await user.clear(field);
    await user.type(field, "Inès B.{Enter}");
    const call = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    );
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      fullName: "Inès B.",
    });
  });

  it("is read-only for Viewers: no checkboxes, no editing, names open the sheet", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    renderGrid(new Set(), vi.fn(), false, onOpen);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Full name of/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add to a list" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Sarra Khelifi" }));
    expect(onOpen).toHaveBeenCalledWith(rosterFixture.contacts[1]);
  });

  it("sorts by name and selects rows", async () => {
    const user = userEvent.setup();
    const onToggle = renderGrid();
    await user.click(screen.getByRole("button", { name: "Sort by Full name" }));
    await user.click(screen.getByRole("button", { name: "Sort by Full name" }));
    const firstRow = () => screen.getAllByRole("row")[1];
    expect(
      within(firstRow()).getByRole("button", { name: /^Full name of/ }),
    ).toHaveTextContent("Youssef Trabelsi");
    await user.click(
      screen.getByRole("checkbox", { name: "Select Sarra Khelifi" }),
    );
    expect(onToggle).toHaveBeenCalledWith(IDS.sarra);
  });
});
