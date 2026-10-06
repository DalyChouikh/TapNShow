import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { IDS, rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { ManageListsDialog } from "./manage-lists-dialog";

const base = "/api/workspaces/club-ab12";

describe("ManageListsDialog", () => {
  it("creates, renames on blur and deletes after confirming", async () => {
    const fetchMock = routeFetch({
      [`POST ${base}/lists`]: json({
        id: "00000000-0000-4000-8000-0000000000d9",
        name: "Media",
      }),
      [`PATCH ${base}/lists/${IDS.dev}`]: json({ ok: true }),
      [`DELETE ${base}/lists/${IDS.design}`]: json({ ok: true }),
      [`GET ${base}/contacts`]: json(rosterFixture),
    });
    const user = userEvent.setup();
    renderWithProviders(
      <ManageListsDialog
        slug="club-ab12"
        lists={rosterFixture.lists}
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("New list"), "Media");
    await user.click(screen.getByRole("button", { name: "Create" }));

    const dev = screen.getByLabelText("Name of the list Dev");
    await user.clear(dev);
    await user.type(dev, "Developers");
    await user.tab();

    await user.click(screen.getByRole("button", { name: "Delete Design" }));
    expect(
      screen.getByText("Delete Design? Its people stay in the roster."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete list" }));

    const calls = fetchMock.mock.calls.map(
      ([url, init]) => `${init?.method ?? "GET"} ${String(url)}`,
    );
    expect(calls).toEqual(
      expect.arrayContaining([
        `POST ${base}/lists`,
        `PATCH ${base}/lists/${IDS.dev}`,
        `DELETE ${base}/lists/${IDS.design}`,
      ]),
    );
  });
});
