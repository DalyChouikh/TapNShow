import { screen } from "@testing-library/react";
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
};

function setup(workspace = workspaceFixture) {
  let current = { ...defaults };
  const fetchMock = routeFetch({
    [`GET ${path}`]: () => new Response(JSON.stringify(current)),
    [`PATCH ${path}`]: (init) => {
      current = { ...current, ...JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ ok: true }));
    },
  });
  renderWithProviders(<MeetingDefaultsSection workspace={workspace} />);
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
});
