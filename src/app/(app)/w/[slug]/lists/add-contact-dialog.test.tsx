import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { AddContactDialog } from "./add-contact-dialog";

const result = (outcome: "new" | "updated") => ({
  summary: {
    new: outcome === "new" ? 1 : 0,
    updated: outcome === "updated" ? 1 : 0,
    unchanged: 0,
    invalid: 0,
    merged: 0,
  },
  newLists: [],
  limitExceeded: null,
  rows: [
    {
      row: 1,
      email: "amira@example.com",
      fullName: "Amira",
      outcome,
      reason: null,
      addedLists: [],
      previousName: null,
      mergedRows: [],
    },
  ],
});

describe("AddContactDialog", () => {
  it("adds one person through the import route with their lists", async () => {
    const fetchMock = routeFetch({
      "POST /api/workspaces/club-ab12/contacts/import": json(result("new")),
      "GET /api/workspaces/club-ab12/contacts": json(rosterFixture),
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <AddContactDialog
        slug="club-ab12"
        roster={rosterFixture}
        open
        onOpenChange={onOpenChange}
      />,
      { toaster: true },
    );
    await user.type(screen.getByLabelText("Full name"), "Amira");
    await user.type(screen.getByLabelText("Email"), "Amira@Example.com");
    await user.click(screen.getByRole("button", { name: "Add to a list" }));
    await user.click(screen.getByRole("option", { name: "Dev" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Add person" }));
    expect(await screen.findByText("Amira added.")).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "POST",
    );
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      rows: [
        {
          row: 1,
          fullName: "Amira",
          email: "amira@example.com",
          lists: ["Dev"],
        },
      ],
      dryRun: false,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says when the email was already in the roster", async () => {
    routeFetch({
      "POST /api/workspaces/club-ab12/contacts/import": json(result("updated")),
      "GET /api/workspaces/club-ab12/contacts": json(rosterFixture),
    });
    const user = userEvent.setup();
    renderWithProviders(
      <AddContactDialog
        slug="club-ab12"
        roster={rosterFixture}
        open
        onOpenChange={vi.fn()}
      />,
      { toaster: true },
    );
    await user.type(screen.getByLabelText("Full name"), "Amira");
    await user.type(screen.getByLabelText("Email"), "amira@example.com");
    await user.click(screen.getByRole("button", { name: "Add person" }));
    expect(
      await screen.findByText("Amira was already in your roster. Updated."),
    ).toBeInTheDocument();
  });
});
