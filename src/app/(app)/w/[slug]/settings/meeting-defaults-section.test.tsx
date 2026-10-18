import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { MeetingDefaultsSection } from "./meeting-defaults-section";

const path = "/api/workspaces/robotics-cd34/meeting-defaults";
const defaults = {
  responseMode: "attendance",
  delayOptions: [5, 10, 15, 30],
  reasonRequired: true,
  commentsEnabled: false,
  footerNote: "",
  durationMinutes: 60,
  onlineText: "",
  meetingUrl: "",
  reminderPendingHours: 24,
  reminderGoingHours: 2,
};

function setup(
  workspace = workspaceFixture,
  initial: Partial<typeof defaults> = {},
) {
  let current = { ...defaults, ...initial };
  const fetchMock = routeFetch({
    [`GET ${path}`]: () => new Response(JSON.stringify(current)),
    [`PATCH ${path}`]: (init) => {
      current = { ...current, ...JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ ok: true }));
    },
  });
  renderWithProviders(<MeetingDefaultsSection workspace={workspace} />, {
    toaster: true,
  });
  const patches = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === "PATCH")
      .map(([, init]) => JSON.parse(String(init?.body)));
  return patches;
}

describe("MeetingDefaultsSection", () => {
  it("saves a delay chip at once", async () => {
    const patches = setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "20 min" }),
    );
    expect(patches()).toEqual([{ delayOptions: [5, 10, 15, 20, 30] }]);
  });

  describe("late choices shorter than the default length (#400)", () => {
    const lateBy = async () => screen.findByRole("group", { name: "Late by" });
    const lengths = () =>
      screen.getByRole("group", { name: "Default duration" });

    it("offers only the late choices shorter than the default length", async () => {
      setup(workspaceFixture, {
        durationMinutes: 30,
        delayOptions: [5, 10, 15],
      });
      const group = await lateBy();
      for (const minutes of [5, 10, 15, 20]) {
        expect(
          within(group).getByRole("button", { name: `${minutes} min` }),
        ).toBeInTheDocument();
      }
      for (const minutes of [30, 45, 60]) {
        expect(
          within(group).queryByRole("button", { name: `${minutes} min` }),
        ).toBeNull();
      }
    });

    it("a shorter default length saves the late choices that fit in the same change, and says so", async () => {
      const patches = setup();
      await lateBy();
      await userEvent.click(
        within(lengths()).getByRole("button", { name: "30 min" }),
      );
      expect(patches()).toEqual([
        { durationMinutes: 30, delayOptions: [5, 10, 15] },
      ]);
      expect(
        await screen.findByText(
          "Removed the late choice 30 min: a late time must be shorter than the meeting.",
        ),
      ).toBeInTheDocument();
    });

    it("saves only the length when every late choice still fits", async () => {
      const patches = setup();
      await lateBy();
      await userEvent.click(
        within(lengths()).getByRole("button", { name: "2 h" }),
      );
      expect(patches()).toEqual([{ durationMinutes: 120 }]);
    });
  });

  it("hides delays outside attendance mode", async () => {
    const patches = setup();
    await userEvent.click(
      await screen.findByRole("radio", { name: "Going / not" }),
    );
    expect(patches()).toEqual([{ responseMode: "rsvp" }]);
    expect(screen.queryByRole("button", { name: "20 min" })).toBeNull();
  });

  it("shows Viewers the values without controls", async () => {
    setup({ ...workspaceFixture, myRole: "viewer" });
    expect(
      await screen.findByText("Going / late / absent"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "20 min" })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("saves the usual online place and link when leaving each field", async () => {
    const patches = setup();
    await userEvent.type(
      await screen.findByLabelText("Usual online place"),
      " Club Discord ",
    );
    await userEvent.tab();
    await userEvent.type(
      screen.getByLabelText("Usual online link (optional)"),
      "https://discord.gg/abc123",
    );
    await userEvent.tab();
    expect(patches()).toEqual([
      { onlineText: "Club Discord" },
      { meetingUrl: "https://discord.gg/abc123" },
    ]);
  });

  it("refuses a link that is not a web address", async () => {
    const patches = setup();
    await userEvent.type(
      await screen.findByLabelText("Usual online link (optional)"),
      "discord.gg/abc",
    );
    await userEvent.tab();
    expect(
      screen.getByText("Use a link that starts with https://"),
    ).toBeInTheDocument();
    expect(patches()).toEqual([]);
  });

  it("saves each reminder row at once (M6)", async () => {
    const patches = setup();
    const pending = await screen.findByRole("radiogroup", {
      name: "Remind people who haven't answered",
    });
    await userEvent.click(within(pending).getByRole("radio", { name: "48 h" }));
    await userEvent.click(
      screen.getByRole("switch", { name: "Remind Going and Late" }),
    );
    expect(patches()).toEqual([
      { reminderPendingHours: 48 },
      { reminderGoingHours: null },
    ]);
  });

  it("shows Viewers the reminders as text", async () => {
    setup({ ...workspaceFixture, myRole: "viewer" });
    expect(await screen.findByText("Reminders")).toBeInTheDocument();
    expect(
      screen.getByText("24 h before the deadline · 2 h before the start"),
    ).toBeInTheDocument();
  });
});
