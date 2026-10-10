import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { MEETING_IDS } from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import type { MeetingSummary } from "@/shared/api/meetings";
import { MeetingCardMenu } from "./meeting-card-menu";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const COPY = "9b1f2a3c-4d5e-4f60-8a71-b2c3d4e5f6aa";
const path = `/api/workspaces/robotics-cd34/meetings/${MEETING_IDS.meeting}`;
const sent: MeetingSummary = {
  id: MEETING_IDS.meeting,
  title: "Weekly sync",
  startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  timezone: "Africa/Tunis",
  durationMinutes: 60,
  status: "scheduled",
  locationMode: "in_person",
  responseMode: "attendance",
  counts: {
    invited: 2,
    sent: 2,
    queued: 0,
    attending: 1,
    late: 0,
    absent: 0,
    noReply: 1,
  },
};
const draft: MeetingSummary = { ...sent, status: "draft" };

function setup(meeting: MeetingSummary) {
  const fetchMock = routeFetch({
    [`DELETE ${path}`]: json({ ok: true }),
    [`POST ${path}/duplicate`]: json({ id: COPY }, 201),
    "GET /api/workspaces/robotics-cd34/meetings": json([]),
  });
  renderWithProviders(
    <MeetingCardMenu slug="robotics-cd34" meeting={meeting} />,
    {
      toaster: true,
    },
  );
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof setup>, method: string) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === method);

async function openMenu() {
  await userEvent.click(
    screen.getByRole("button", { name: "Actions for Weekly sync" }),
  );
}

beforeEach(() => {
  router.push.mockClear();
});

describe("MeetingCardMenu", () => {
  it("offers Duplicate on a sent meeting, without Delete draft", async () => {
    setup(sent);
    await openMenu();
    expect(
      await screen.findByRole("menuitem", { name: "Duplicate" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete draft" })).toBeNull();
  });

  it("duplicates and opens the copy's Details step", async () => {
    const fetchMock = setup(sent);
    await openMenu();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Duplicate" }),
    );
    expect(
      await screen.findByText("Copy created. Pick a date."),
    ).toBeInTheDocument();
    expect(calls(fetchMock, "POST")).toHaveLength(1);
    expect(router.push).toHaveBeenCalledWith(
      `/w/robotics-cd34/meetings/${COPY}/edit?step=details`,
    );
  });

  it("deletes a draft after confirming", async () => {
    const fetchMock = setup(draft);
    await openMenu();
    expect(
      await screen.findByRole("menuitem", { name: "Duplicate" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Delete draft" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete this draft?")).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete draft" }),
    );
    expect(calls(fetchMock, "DELETE")).toHaveLength(1);
  });

  it("deletes nothing when cancelled", async () => {
    const fetchMock = setup(draft);
    await openMenu();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Delete draft" }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    expect(calls(fetchMock, "DELETE")).toHaveLength(0);
  });
});
