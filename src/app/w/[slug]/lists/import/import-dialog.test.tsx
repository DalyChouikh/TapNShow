import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { routeFetch } from "@/test/fetch";
import { importPreviewFixture, rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { ImportDialog } from "./import-dialog";

const IMPORT = "POST /api/workspaces/club-ab12/contacts/import";

describe("ImportDialog", () => {
  it("pastes, matches, previews and imports", async () => {
    const committed = {
      ...importPreviewFixture,
      summary: { ...importPreviewFixture.summary },
    };
    const fetchMock = routeFetch({
      [IMPORT]: (init) =>
        new Response(
          JSON.stringify(
            JSON.parse(String(init?.body)).dryRun
              ? importPreviewFixture
              : committed,
          ),
          { status: 200 },
        ),
      "GET /api/workspaces/club-ab12/contacts": () =>
        new Response(JSON.stringify(rosterFixture)),
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ImportDialog
        slug="club-ab12"
        roster={rosterFixture}
        initialSource="paste"
        open
        onOpenChange={onOpenChange}
      />,
      { toaster: true },
    );
    expect(
      screen.getByRole("dialog", { name: "Import people" }),
    ).toBeInTheDocument();
    await user.click(screen.getByLabelText("Paste rows"));
    await user.paste(
      "Full name\tEmail\tTeam\nAmira\tamira@example.com\tEvents",
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
    const bodies = () =>
      fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies()[0]).toEqual({
      rows: [
        {
          row: 2,
          fullName: "Amira",
          email: "amira@example.com",
          lists: ["Events"],
        },
      ],
      dryRun: true,
    });
    await user.click(screen.getByRole("button", { name: "Import 2 people" }));
    expect(
      await screen.findByText("1 added, 1 updated, 1 list created."),
    ).toBeInTheDocument();
    expect(bodies()[1]).toMatchObject({ dryRun: false });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps every footer button the same height on every step (owner request)", async () => {
    const user = userEvent.setup();
    routeFetch({
      [IMPORT]: () => new Response(JSON.stringify(importPreviewFixture)),
    });
    renderWithProviders(
      <ImportDialog
        slug="club-ab12"
        roster={rosterFixture}
        initialSource="paste"
        open
        onOpenChange={vi.fn()}
      />,
    );
    const footerButtons = () =>
      screen
        .getAllByRole("button")
        .filter((b) => b.closest("[data-slot=wizard-footer]"));
    const expectEqualHeights = () => {
      for (const button of footerButtons()) {
        expect(button).toHaveClass("h-11", "whitespace-nowrap");
      }
    };
    expectEqualHeights();
    await user.click(screen.getByLabelText("Paste rows"));
    await user.paste("Email\na@example.com");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expectEqualHeights();
    await user.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText("Step 3 of 3");
    expectEqualHeights();
    expect(footerButtons()).toHaveLength(2);
  });
});
