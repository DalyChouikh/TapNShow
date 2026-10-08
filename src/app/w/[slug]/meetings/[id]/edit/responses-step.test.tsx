import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { meetingFixture } from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import { ResponsesStep } from "./responses-step";
import { WIZARD_STEPS } from "./wizard-steps";

const path = `/api/workspaces/robotics-cd34/meetings/${meetingFixture.id}`;

function setup() {
  const fetchMock = routeFetch({
    [`PATCH ${path}`]: (init) =>
      new Response(
        JSON.stringify({
          ...meetingFixture,
          ...JSON.parse(String(init?.body)),
        }),
      ),
    "GET /api/workspaces/robotics-cd34/meetings": () => new Response("[]"),
  });
  const goTo = vi.fn();
  renderWithProviders(
    <ResponsesStep
      slug="robotics-cd34"
      meeting={meetingFixture}
      workspace={workspaceFixture}
      steps={WIZARD_STEPS}
      goTo={goTo}
    />,
  );
  const patches = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === "PATCH")
      .map(([, init]) => JSON.parse(String(init?.body)));
  return { goTo, patches };
}

const next = () =>
  userEvent.click(screen.getByRole("button", { name: "Next: Review" }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("ResponsesStep", () => {
  it("hides every setting for an announcement", async () => {
    setup();
    await userEvent.click(screen.getByRole("radio", { name: "No answers" }));
    expect(
      screen.getByText("An announcement: the email has no answer buttons."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Late by")).toBeNull();
    expect(screen.queryByLabelText("Allow a comment")).toBeNull();
  });

  it("needs a delay, and ignores a seventh one", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "20 min" }));
    await userEvent.click(screen.getByRole("button", { name: "45 min" }));
    const sixty = screen.getByRole("button", { name: "60 min" });
    await userEvent.click(sixty);
    expect(sixty).toHaveAttribute("aria-pressed", "false");
    for (const minutes of [5, 10, 15, 20, 30, 45]) {
      await userEvent.click(
        screen.getByRole("button", { name: `${minutes} min` }),
      );
    }
    await next();
    expect(screen.getByText("Pick at least one delay.")).toBeInTheDocument();
  });

  it("keeps the deadline before the start", async () => {
    const { patches } = setup();
    await userEvent.click(
      screen.getByRole("switch", { name: "Answer deadline" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Pick a date/ }));
    await userEvent.click(
      screen.getByRole("button", { name: /October 9th, 2026/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Pick a time/ }));
    await userEvent.click(screen.getByRole("option", { name: "19:00" }));
    await next();
    expect(
      screen.getByText(
        "The deadline must be before the meeting starts and in the future.",
      ),
    ).toBeInTheDocument();
    expect(patches()).toEqual([]);
  });

  it("saves the answers and moves to the review", async () => {
    const { goTo, patches } = setup();
    await userEvent.click(
      screen.getByRole("switch", { name: "Allow a comment" }),
    );
    await next();
    await vi.waitFor(() => expect(goTo).toHaveBeenCalledWith("review"));
    expect(patches()[0]).toEqual({
      responseMode: "attendance",
      delayOptions: [5, 10, 15, 30],
      reasonRequired: true,
      commentsEnabled: true,
      footerNote: "",
      responseDeadline: null,
    });
  });
});
