import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { meetingFixture } from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import { StepHarness } from "@/test/wizard";
import { DetailsStep } from "./details-step";
import { EDIT_STEPS, WIZARD_STEPS } from "./wizard-steps";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const path = `/api/workspaces/robotics-cd34/meetings/${meetingFixture.id}`;
const blank = { ...meetingFixture, title: "", startsAt: null };
const sent = { ...meetingFixture, status: "scheduled" as const };

function setup(mode: "draft" | "edit" = "draft") {
  const fetchMock = routeFetch({
    [`PATCH ${path}`]: (init) =>
      new Response(
        JSON.stringify({ ...blank, ...JSON.parse(String(init?.body)) }),
      ),
    "GET /api/workspaces/robotics-cd34/meetings": () => new Response("[]"),
  });
  const goTo = vi.fn();
  renderWithProviders(
    <StepHarness
      Step={DetailsStep}
      slug="robotics-cd34"
      meeting={mode === "edit" ? sent : blank}
      mode={mode}
      workspace={workspaceFixture}
      steps={mode === "edit" ? EDIT_STEPS : WIZARD_STEPS}
      goTo={goTo}
    />,
  );
  const patches = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === "PATCH")
      .map(([, init]) => JSON.parse(String(init?.body)));
  return { goTo, patches };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("DetailsStep", () => {
  it("names what is missing and saves nothing", async () => {
    const { goTo, patches } = setup();
    await userEvent.click(
      screen.getByRole("button", { name: "Next: Audience" }),
    );
    expect(screen.getByText("Give the meeting a title.")).toBeInTheDocument();
    expect(patches()).toEqual([]);
    expect(goTo).not.toHaveBeenCalled();
  });

  it("saves the picked wall time as UTC and moves to the audience", async () => {
    const { goTo, patches } = setup();
    await userEvent.type(screen.getByLabelText("Title"), "Kickoff");
    await userEvent.click(screen.getByRole("button", { name: /Pick a date/ }));
    await userEvent.click(
      screen.getByRole("button", { name: /October 9th, 2026/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Pick a time/ }));
    await userEvent.click(screen.getByRole("option", { name: "18:00" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Next: Audience" }),
    );
    await vi.waitFor(() => expect(goTo).toHaveBeenCalledWith("audience"));
    expect(patches().at(-1)).toMatchObject({
      title: "Kickoff",
      startsAt: "2026-10-09T17:00:00.000Z",
      timezone: "Africa/Tunis",
    });
  });

  it("asks for a link instead of a place when the meeting is online", async () => {
    setup();
    expect(screen.getByLabelText("Place")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Online" }));
    expect(screen.getByLabelText("Where online?")).toBeInTheDocument();
    expect(screen.getByLabelText("Link (optional)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Place")).toBeNull();
  });

  it("keeps edits of a sent meeting in the draft, then goes to Answers (M6)", async () => {
    const { goTo, patches } = setup("edit");
    const title = screen.getByLabelText("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "Weekly sync, room change");
    await userEvent.click(
      screen.getByRole("button", { name: "Next: Answers" }),
    );
    expect(goTo).toHaveBeenCalledWith("responses");
    expect(patches()).toEqual([]);
    expect(
      JSON.parse(sessionStorage.getItem(`tn:edit:${sent.id}`) ?? "null"),
    ).toEqual({ title: "Weekly sync, room change" });
    sessionStorage.clear();
  });
});
