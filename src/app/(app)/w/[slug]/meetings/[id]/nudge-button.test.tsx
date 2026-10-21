import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import {
  meetingFixture,
  MEETING_IDS,
  resultsFixture,
} from "@/test/fixtures/meetings";
import { senderFixture } from "@/test/fixtures/sender";
import { renderWithProviders } from "@/test/render";
import type { Meeting } from "@/shared/api/meetings";
import type { MeetingResults } from "@/shared/api/responses";
import { NudgeButton } from "./nudge-button";

const base = "/api/workspaces/robotics-cd34";
const meetingPath = `${base}/meetings/${MEETING_IDS.meeting}`;
const scheduled: Meeting = {
  ...meetingFixture,
  status: "scheduled",
  startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
};
const withRemindable = (remindable: number, nudge = resultsFixture.nudge) => ({
  ...resultsFixture,
  answers: { ...resultsFixture.answers, remindable },
  nudge,
});

type SenderState = "active" | "broken" | "missing";

/** The workspace's sender in `state`, as the sender route returns it. */
function senderIn(state: SenderState) {
  const fixture = senderFixture(state !== "missing");
  return fixture.sender
    ? { ...fixture, sender: { ...fixture.sender, status: state } }
    : fixture;
}

function setup(
  meeting: Meeting,
  results: MeetingResults,
  options: {
    sender?: SenderState;
    refusal?: string;
    canConnect?: boolean;
  } = {},
) {
  const { refusal } = options;
  const fetchMock = routeFetch({
    [`GET ${base}/sender`]: json(senderIn(options.sender ?? "active")),
    [`POST ${meetingPath}/nudge`]: refusal
      ? () =>
          new Response(JSON.stringify({ error: { code: refusal } }), {
            status: 409,
          })
      : json({
          reminded: results.answers.remindable,
          nextAt: new Date(Date.now() + 12 * 3600_000).toISOString(),
        }),
    [`GET ${meetingPath}/results`]: json(results),
  });
  const view = renderWithProviders(
    <NudgeButton
      slug="robotics-cd34"
      meeting={meeting}
      results={results}
      canConnect={options.canConnect ?? false}
    />,
    { toaster: true },
  );
  return { fetchMock, view };
}

describe("NudgeButton", () => {
  it.each([
    ["nudge_too_soon", "You can remind people again later."],
    [
      "nothing_to_send",
      "Everyone has answered, or a reminder is already on its way.",
    ],
    ["sender_broken", "Ask Daly to connect Gmail to send reminders."],
  ])(
    "says in plain words why a %s nudge was refused (review)",
    async (code, text) => {
      setup(scheduled, withRemindable(6), { refusal: code });
      await userEvent.click(
        await screen.findByRole("button", {
          name: "Remind 6 who haven't answered",
        }),
      );
      const dialog = await screen.findByRole("dialog");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Send reminders" }),
      );
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(text);
    },
  );

  it("reminds people who haven't answered after saying from which Gmail", async () => {
    const { fetchMock } = setup(scheduled, withRemindable(6));
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Remind 6 who haven't answered",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "Email 6 people who haven't answered from club@gmail.com?",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("They get a reminder with the answer buttons."),
    ).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Send reminders" }),
    );
    expect(await screen.findByText("Reminded 6 people.")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });

  it("says when people were reminded and when it can run again", () => {
    setup(
      scheduled,
      withRemindable(6, {
        lastAt: "2026-10-08T13:20:00.000Z",
        lastCount: 6,
        nextAt: new Date(Date.now() + 3600_000).toISOString(),
      }),
    );
    expect(
      screen.getByText(/^Reminded 6 at 14:20 · available again at \d\d:\d\d$/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows nothing with nobody to remind, for announcements, started or cancelled meetings", () => {
    const empty = setup(scheduled, withRemindable(0));
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Remind/)).toBeNull();
    empty.view.unmount();
    for (const meeting of [
      { ...scheduled, responseMode: "announcement" as const },
      { ...scheduled, startsAt: new Date(Date.now() - 60_000).toISOString() },
      { ...scheduled, status: "cancelled" as const },
    ]) {
      const { view } = setup(meeting, withRemindable(6));
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByText(/Remind/)).toBeNull();
      view.unmount();
    }
  });

  it("asks for a connected Gmail first (Review Focus 4)", async () => {
    setup(scheduled, withRemindable(6), { sender: "missing" });
    expect(
      await screen.findByText("Ask Daly to connect Gmail to send reminders."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remind 6 who haven't answered" }),
    ).toBeDisabled();
  });

  const CONNECT_HREF =
    "/api/integrations/google/connect?workspace=robotics-cd34&purpose=sending";

  it.each([
    ["missing", "Connect Gmail to send reminders"],
    ["broken", "Reconnect Gmail to send reminders"],
  ] as const)(
    "offers the Owner to fix a %s Gmail instead of asking themselves (#420)",
    async (sender, label) => {
      setup(scheduled, withRemindable(6), { sender, canConnect: true });
      expect(await screen.findByRole("link", { name: label })).toHaveAttribute(
        "href",
        CONNECT_HREF,
      );
      expect(screen.queryByText(/^Ask /)).toBeNull();
      expect(
        screen.getByRole("button", { name: "Remind 6 who haven't answered" }),
      ).toBeDisabled();
    },
  );

  it("asks an Admin to get the Owner to reconnect a broken Gmail (#420)", async () => {
    setup(scheduled, withRemindable(6), { sender: "broken" });
    expect(
      await screen.findByText("Ask Daly to connect Gmail to send reminders."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it.each([
    ["sender_not_connected", "Connect Gmail to send reminders"],
    ["sender_broken", "Reconnect Gmail to send reminders"],
  ])(
    "offers the Owner the fix when a %s refusal comes back (#420)",
    async (refusal, label) => {
      setup(scheduled, withRemindable(6), { refusal, canConnect: true });
      await userEvent.click(
        await screen.findByRole("button", {
          name: "Remind 6 who haven't answered",
        }),
      );
      const dialog = await screen.findByRole("dialog");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Send reminders" }),
      );
      const alert = await within(dialog).findByRole("alert");
      expect(within(alert).getByRole("link", { name: label })).toHaveAttribute(
        "href",
        CONNECT_HREF,
      );
      expect(alert).not.toHaveTextContent(/Ask /);
    },
  );
});
