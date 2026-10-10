import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { meetingFixture } from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import { StepHarness } from "@/test/wizard";
import { ChangesStep } from "./changes-step";
import { EDIT_STEPS } from "./wizard-steps";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const base = `/api/workspaces/${workspaceFixture.slug}`;
const meetingPath = `${base}/meetings/${meetingFixture.id}`;
const sent = { ...meetingFixture, status: "scheduled" as const };
const storageKey = `tn:edit:${sent.id}`;
const moved = {
  changed: true,
  changes: {
    starts_at: ["2026-10-09T17:00:00+00:00", "2026-10-10T17:00:00+00:00"],
  },
  emails: 3,
  calendarOnly: 0,
  reconfirm: true,
};
const sender = (connected = true) => ({
  sender: connected
    ? {
        connectionId: "3f1c2b8e-6a43-4f0e-9a51-1f2c3d4e5f60",
        email: "club@gmail.com",
        status: "active",
        connectedBy: "Daly",
        connectedAt: "2026-10-07T10:00:00Z",
        isMine: true,
        sentLast24h: 60,
        dailyLimit: 400,
      }
    : null,
  ownerName: "Daly",
  myConnections: [],
});

function setup({
  draft = { startsAt: "2026-10-10T17:00:00.000Z" } as object | null,
  previews = [moved] as object[],
  saveResponse = () => new Response(JSON.stringify(moved)),
  connected = true,
} = {}) {
  if (draft) {
    sessionStorage.setItem(storageKey, JSON.stringify(draft));
  }
  const bodies: { notify: boolean; dryRun: boolean }[] = [];
  let preview = 0;
  routeFetch({
    [`POST ${meetingPath}/changes`]: (init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (!body.dryRun) {
        return saveResponse();
      }
      const next = previews[Math.min(preview, previews.length - 1)];
      preview += 1;
      return new Response(JSON.stringify(next));
    },
    [`GET ${base}/sender`]: json(sender(connected)),
    [`GET ${base}/meetings`]: json([]),
    [`GET ${meetingPath}`]: json(sent),
    [`GET ${meetingPath}/results`]: json({}),
  });
  const goTo = vi.fn();
  renderWithProviders(
    <StepHarness
      Step={ChangesStep}
      slug={workspaceFixture.slug}
      meeting={sent}
      workspace={workspaceFixture}
      steps={EDIT_STEPS}
      goTo={goTo}
      mode="edit"
    />,
    { toaster: true },
  );
  return { goTo, bodies };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));
  router.push.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});

describe("ChangesStep", () => {
  it("shows the meeting with the changes marked, and who is told", async () => {
    setup();
    const before = await screen.findByText(
      "Fri 9 Oct, 18:00–19:00 (Africa/Tunis)",
    );
    expect(before.closest("del")).not.toBeNull();
    expect(
      screen.getByText("Sat 10 Oct, 18:00–19:00 (Africa/Tunis)").closest("ins"),
    ).not.toBeNull();
    expect(screen.getAllByText("Before:")[0]).toHaveClass("sr-only");
    expect(screen.getByText("Emails 3 people.")).toBeInTheDocument();
    expect(
      screen.getByText("Everyone will be asked to confirm again."),
    ).toBeInTheDocument();
    expect(screen.getByText(/3 emails now/)).toBeInTheDocument();
    expect(screen.queryByText(/calendar/)).toBeNull();
  });

  it("asks before saving and emailing, then saves for real", async () => {
    const { bodies } = setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "Save and email 3 people" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Save and email 3 people?"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "They get one email with the changes and are asked to confirm again.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save and email 3 people" }),
    );
    expect(await screen.findByText("Changes saved.")).toBeInTheDocument();
    expect(bodies.at(-1)).toMatchObject({ dryRun: false, notify: false });
    expect(router.push).toHaveBeenCalledWith(
      `/w/${workspaceFixture.slug}/meetings/${sent.id}`,
    );
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("offers to email everyone about a text change, and previews it", async () => {
    const titled = {
      changed: true,
      changes: { title: ["Weekly sync", "Weekly sync (room)"] },
      emails: 0,
      calendarOnly: 1,
      reconfirm: false,
    };
    const { bodies } = setup({
      draft: { title: "Weekly sync (room)" },
      previews: [titled, { ...titled, emails: 3, calendarOnly: 0 }],
    });
    expect(
      await screen.findByText(
        "1 person who added it to their calendar gets a short note.",
      ),
    ).toBeInTheDocument();
    const notify = screen.getByRole("switch", {
      name: "Email everyone about this change",
    });
    expect(notify).toHaveAttribute("aria-checked", "false");
    await userEvent.click(notify);
    expect(await screen.findByText("Emails 3 people.")).toBeInTheDocument();
    expect(bodies.at(-1)).toMatchObject({ dryRun: true, notify: true });
  });

  it("names the calendar note in the confirm when only calendars change (review)", async () => {
    const titled = {
      changed: true,
      changes: { title: ["Weekly sync", "Weekly sync (room)"] },
      emails: 0,
      calendarOnly: 1,
      reconfirm: false,
    };
    setup({ draft: { title: "Weekly sync (room)" }, previews: [titled] });
    await userEvent.click(
      await screen.findByRole("button", { name: "Save changes" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Save and update 1 person's calendar?"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "They get a short note, and the event in their calendar changes too.",
      ),
    ).toBeInTheDocument();
  });

  it("saves at once when nobody is emailed", async () => {
    const quiet = {
      changed: true,
      changes: { reason_required: [true, false] },
      emails: 0,
      calendarOnly: 0,
      reconfirm: false,
    };
    const { bodies } = setup({
      draft: { reasonRequired: false },
      previews: [quiet],
      saveResponse: () => new Response(JSON.stringify(quiet)),
    });
    expect(await screen.findByText("Nobody is emailed.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await vi.waitFor(() => expect(bodies.at(-1)?.dryRun).toBe(false));
  });

  it("says the emails wait while Gmail is not connected", async () => {
    setup({ connected: false });
    expect(
      await screen.findByText("Emails will wait until Gmail is reconnected."),
    ).toBeInTheDocument();
  });

  it("has nothing to save when nothing changed", () => {
    setup({ draft: null });
    expect(screen.getByText("Nothing changed yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
  });

  it("discards the changes after asking", async () => {
    setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "Discard changes" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Discard your changes?"),
    ).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Discard changes" }),
    );
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(router.push).toHaveBeenCalledWith(
      `/w/${workspaceFixture.slug}/meetings/${sent.id}`,
    );
  });

  it("explains a refusal in plain words", async () => {
    setup({
      saveResponse: () =>
        new Response(JSON.stringify({ error: { code: "meeting_started" } }), {
          status: 409,
        }),
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Save and email 3 people" }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save and email 3 people" }),
    );
    expect(
      await screen.findByText(
        "The meeting has started, so it can't be changed.",
      ),
    ).toBeInTheDocument();
  });
});
