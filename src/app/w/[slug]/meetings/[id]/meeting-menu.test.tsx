import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import {
  meetingFixture,
  MEETING_IDS,
  resultsFixture,
} from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import type { Meeting } from "@/shared/api/meetings";
import { MeetingMenu } from "./meeting-menu";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const base = "/api/workspaces/robotics-cd34";
const meetingPath = `${base}/meetings/${MEETING_IDS.meeting}`;
const COPY = "9b1f2a3c-4d5e-4f60-8a71-b2c3d4e5f6aa";
const future = new Date(Date.now() + 2 * 86_400_000).toISOString();
const scheduled: Meeting = {
  ...meetingFixture,
  status: "scheduled",
  startsAt: future,
};
const results = (reachable: number) => ({
  ...resultsFixture,
  answers: { ...resultsFixture.answers, reachable },
});

function setup(
  meeting: Meeting,
  {
    reachable = 28,
    workspace = workspaceFixture,
    deleteResponse = () => new Response(JSON.stringify({ ok: true })),
  } = {},
) {
  const fetchMock = routeFetch({
    [`GET ${base}`]: json(workspace),
    [`POST ${meetingPath}/cancel`]: json({ emails: reachable }),
    [`DELETE ${meetingPath}`]: deleteResponse,
    [`POST ${meetingPath}/duplicate`]: json({ id: COPY }, 201),
    [`GET ${meetingPath}`]: json(meeting),
    [`GET ${meetingPath}/results`]: json(results(reachable)),
    [`GET ${base}/meetings`]: json([]),
  });
  renderWithProviders(
    <MeetingMenu
      slug="robotics-cd34"
      meeting={meeting}
      results={results(reachable)}
    />,
    { toaster: true },
  );
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof setup>, method: string) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === method);

async function open() {
  await userEvent.click(
    await screen.findByRole("button", { name: "Meeting actions" }),
  );
}

const items = () =>
  screen.getAllByRole("menuitem").map((item) => item.textContent);

beforeEach(() => router.push.mockClear());

describe("MeetingMenu", () => {
  it("offers Edit, Duplicate and Cancel meeting before the start", async () => {
    setup(scheduled);
    await open();
    expect(items()).toEqual(["Edit", "Duplicate", "Cancel meeting"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(router.push).toHaveBeenCalledWith(
      `/w/robotics-cd34/meetings/${MEETING_IDS.meeting}/edit?mode=edit&step=details`,
    );
  });

  it("offers only Duplicate after the start, and Delete once cancelled", async () => {
    setup({
      ...scheduled,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await open();
    expect(items()).toEqual(["Duplicate"]);
  });

  it("offers Duplicate and Delete on a cancelled meeting", async () => {
    setup({ ...scheduled, status: "cancelled" });
    await open();
    expect(items()).toEqual(["Duplicate", "Delete"]);
  });

  it("is not there for Viewers", async () => {
    setup(scheduled, { workspace: { ...workspaceFixture, myRole: "viewer" } });
    await screen.findByText(/./, { selector: "body *" }).catch(() => null);
    expect(
      screen.queryByRole("button", { name: "Meeting actions" }),
    ).toBeNull();
  });

  it("cancels after naming who is emailed", async () => {
    const fetchMock = setup(scheduled);
    await open();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Cancel meeting" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Cancel this meeting and email 28 people?"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Everyone invited gets a cancellation email, and it is removed from calendars. This can't be undone.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Keep meeting" }),
    ).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel meeting" }),
    );
    expect(
      await screen.findByText(
        "Meeting cancelled. 28 cancellation emails are going out.",
      ),
    ).toBeInTheDocument();
    expect(calls(fetchMock, "POST")).toHaveLength(1);
  });

  it("says so plainly when nobody is emailed", async () => {
    setup(scheduled, { reachable: 0 });
    await open();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Cancel meeting" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Cancel this meeting?"),
    ).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel meeting" }),
    );
    expect(await screen.findByText("Meeting cancelled.")).toBeInTheDocument();
  });

  it("deletes a cancelled meeting for good, or says the emails are still going out", async () => {
    let attempts = 0;
    setup(
      { ...scheduled, status: "cancelled" },
      {
        deleteResponse: () => {
          attempts += 1;
          return attempts === 1
            ? new Response(
                JSON.stringify({ error: { code: "cancel_emails_pending" } }),
                { status: 409 },
              )
            : new Response(JSON.stringify({ ok: true }));
        },
      },
    );
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Delete this meeting for good?"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Its answers will be gone. This can't be undone.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete" }),
    );
    expect(
      await within(dialog).findByText(
        "The cancellation emails are still going out. Try again in a few minutes.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete" }),
    );
    await vi.waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/w/robotics-cd34/meetings"),
    );
  });

  it("duplicates into a new draft", async () => {
    setup(scheduled);
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await vi.waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        `/w/robotics-cd34/meetings/${COPY}/edit?step=details`,
      ),
    );
  });
});
