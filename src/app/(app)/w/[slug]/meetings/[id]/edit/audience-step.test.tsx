import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import {
  audienceFixture,
  meetingFixture,
  MEETING_IDS,
} from "@/test/fixtures/meetings";
import { workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { StepHarness } from "@/test/wizard";
import { AudienceStep } from "./audience-step";
import { WIZARD_STEPS } from "./wizard-steps";

const roster = {
  contacts: [],
  lists: [
    { id: MEETING_IDS.members, name: "Members", contactCount: 2 },
    { id: MEETING_IDS.committee, name: "Committee", contactCount: 2 },
  ],
  limits: { contactsMax: 2000, listsMax: 50, importRowsMax: 2000 },
};
let fetchMock: ReturnType<typeof routeFetch>;
const goTo = vi.fn();
const base = `/api/workspaces/${workspaceFixture.slug}`;

beforeEach(() => {
  goTo.mockReset();
  fetchMock = routeFetch({
    [`GET ${base}/contacts`]: json(roster),
    [`GET ${base}/meetings/${MEETING_IDS.meeting}/audience`]:
      json(audienceFixture),
    [`PUT ${base}/meetings/${MEETING_IDS.meeting}/audience`]: (init) => {
      const body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          ...audienceFixture,
          listIds: body.listIds,
          counts: { ...audienceFixture.counts, toInvite: body.listIds.length },
        }),
      );
    },
  });
});

const renderStep = () =>
  renderWithProviders(
    <StepHarness
      Step={AudienceStep}
      slug={workspaceFixture.slug}
      meeting={meetingFixture}
      workspace={workspaceFixture}
      steps={WIZARD_STEPS}
      goTo={goTo}
    />,
  );

describe("AudienceStep", () => {
  it("shows the picked lists, the count and marks, and names the next step with the count", async () => {
    renderStep();
    expect(
      await screen.findByRole("button", { name: /Members 2/, pressed: true }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 people")).toBeInTheDocument();
    expect(screen.getByText("1 in more than one list")).toBeInTheDocument();
    expect(
      screen.getByText("1 unsubscribed person won't be emailed"),
    ).toBeInTheDocument();
    const lina = screen.getByText("Lina M.").closest("li");
    expect(
      within(lina as HTMLElement).getByText("Unsubscribed"),
    ).toBeInTheDocument();
    expect(within(lina as HTMLElement).getByRole("checkbox")).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Next: 2 people" }),
    );
    expect(goTo).toHaveBeenCalledWith("responses");
  });

  it("saves list toggles and person toggles as audience bodies", async () => {
    renderStep();
    await userEvent.click(
      await screen.findByRole("button", { name: /Committee 2/ }),
    );
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({
      listIds: [MEETING_IDS.members],
      include: [],
      exclude: [],
    });
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Invite Amira B." }),
    );
    const last = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "PUT")
      .at(-1);
    expect(JSON.parse(String(last?.[1]?.body)).exclude).toContain(
      MEETING_IDS.amira,
    );
  });

  it("filters by search, accent-insensitively", async () => {
    renderStep();
    await userEvent.type(await screen.findByRole("searchbox"), "youssef");
    expect(screen.queryByText("Amira B.")).not.toBeInTheDocument();
    expect(screen.getByText("Youssef K.")).toBeInTheDocument();
  });
});

describe("AudienceStep quick taps", () => {
  it("applies two list toggles made before the first save returns", async () => {
    let current = { ...audienceFixture };
    fetchMock = routeFetch({
      [`GET ${base}/contacts`]: json(roster),
      [`GET ${base}/meetings/${MEETING_IDS.meeting}/audience`]: () =>
        new Response(JSON.stringify(current)),
      [`PUT ${base}/meetings/${MEETING_IDS.meeting}/audience`]: (init) => {
        const body = JSON.parse(String(init?.body));
        current = { ...current, listIds: body.listIds };
        return new Response(JSON.stringify(current));
      },
    });
    renderStep();
    const committee = await screen.findByRole("button", {
      name: /Committee 2/,
    });
    const members = screen.getByRole("button", { name: /Members 2/ });
    const user = userEvent.setup();
    await Promise.all([user.click(committee), user.click(members)]);
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT"),
      ).toHaveLength(2),
    );
    const puts = fetchMock.mock.calls.filter(
      ([, init]) => init?.method === "PUT",
    );
    expect(JSON.parse(String(puts[1][1]?.body)).listIds).toEqual([]);
  });
});
