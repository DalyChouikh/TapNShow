import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { MEETING_IDS } from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import { DraftMenu } from "./draft-menu";

const path = `/api/workspaces/robotics-cd34/meetings/${MEETING_IDS.meeting}`;

function setup() {
  const fetchMock = routeFetch({
    [`DELETE ${path}`]: json({ ok: true }),
    "GET /api/workspaces/robotics-cd34/meetings": json([]),
  });
  renderWithProviders(
    <DraftMenu
      slug="robotics-cd34"
      meetingId={MEETING_IDS.meeting}
      title="Weekly sync"
    />,
  );
  return fetchMock;
}

const deletes = (fetchMock: ReturnType<typeof setup>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE");

describe("DraftMenu", () => {
  it("deletes the draft after confirming", async () => {
    const fetchMock = setup();
    await userEvent.click(
      screen.getByRole("button", { name: "Draft actions for Weekly sync" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Delete draft" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete this draft?")).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete draft" }),
    );
    expect(deletes(fetchMock)).toHaveLength(1);
  });

  it("sends nothing when cancelled", async () => {
    const fetchMock = setup();
    await userEvent.click(
      screen.getByRole("button", { name: "Draft actions for Weekly sync" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Delete draft" }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    expect(deletes(fetchMock)).toHaveLength(0);
  });
});
