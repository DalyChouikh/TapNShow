import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { addDays } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HISTORY_DEFAULT_PERIOD } from "@/config/responses";
import { periodRange } from "@/lib/responses/periods";
import type { Meeting, MeetingSummary } from "@/shared/api/meetings";
import { type FetchRoute, json, routeFetch } from "@/test/fetch";
import { insightsFixture } from "@/test/fixtures/insights";
import { meFixture, workspaceFixture } from "@/test/fixtures/me";
import { meetingFixture, resultsFixture } from "@/test/fixtures/meetings";
import { senderFixture } from "@/test/fixtures/sender";
import { sheetFixture } from "@/test/fixtures/sheet";
import { setWideViewport } from "@/test/match-media";
import { renderWithProviders } from "@/test/render";
import WorkspaceHomePage from "./page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "robotics-cd34" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/w/robotics-cd34",
}));

/** Afternoon on the test machine's clock from UTC to UTC+4. */
const NOW = new Date("2026-10-17T13:00:00.000Z");
const base = "/api/workspaces/robotics-cd34";
const range = periodRange(HISTORY_DEFAULT_PERIOD, NOW, "Africa/Tunis");
const INSIGHTS = `GET ${base}/insights?${new URLSearchParams({ from: range.from ?? "" })}`;
const LIST = `GET ${base}/meetings?tab=upcoming&limit=1`;
const next: Meeting = {
  ...meetingFixture,
  status: "scheduled",
  sentAt: addDays(NOW, -1).toISOString(),
  startsAt: addDays(NOW, 2).toISOString(),
};
const summary: MeetingSummary = {
  id: next.id,
  title: next.title,
  startsAt: next.startsAt,
  timezone: next.timezone,
  durationMinutes: next.durationMinutes,
  status: next.status,
  locationMode: next.locationMode,
  responseMode: next.responseMode,
  counts: {
    invited: 2,
    sent: 2,
    queued: 0,
    attending: 0,
    late: 0,
    absent: 0,
    noReply: 1,
  },
};
const refused = () =>
  new Response(JSON.stringify({ error: { code: "forbidden" } }), {
    status: 403,
  });
/** Refuses the first call, then answers with `body`. */
function failingOnce(body: object): FetchRoute & { calls: () => number } {
  let calls = 0;
  const route = () => {
    calls += 1;
    return calls === 1 ? refused() : new Response(JSON.stringify(body));
  };
  return Object.assign(route, { calls: () => calls });
}

function serve(
  options: {
    members?: number;
    sender?: boolean;
    sheet?: "off" | "on";
    meeting?: boolean;
    routes?: Record<string, FetchRoute>;
  } = {},
) {
  routeFetch({
    [`GET ${base}`]: json(workspaceFixture),
    "GET /api/me": json(meFixture),
    [INSIGHTS]: json(
      options.members === 0
        ? {
            ...insightsFixture,
            roster: { ...insightsFixture.roster, members: 0 },
            held: 0,
            period: {
              meetings: 0,
              cameAverage: 0,
              invitedAverage: 0,
              answeredBeforeStart: null,
            },
            chart: [],
            oftenMissing: [],
          }
        : insightsFixture,
    ),
    [`GET ${base}/sender`]: json(senderFixture(options.sender ?? true)),
    [`GET ${base}/sheet`]: json(sheetFixture(options.sheet ?? "off")),
    [LIST]: json({
      items: options.meeting === false ? [] : [summary],
      nextCursor: null,
    }),
    [`GET ${base}/meetings?tab=drafts&limit=1`]: json({
      items: [],
      nextCursor: null,
    }),
    [`GET ${base}/meetings/${next.id}`]: json(next),
    [`GET ${base}/meetings/${next.id}/results`]: json({
      ...resultsFixture,
      emails: { ...resultsFixture.emails, queued: 0 },
    }),
    ...options.routes,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  setWideViewport(false);
});
afterEach(() => vi.useRealTimers());

const headings = () =>
  screen.getAllByRole("heading").map((heading) => heading.textContent);

describe("Workspace Home", () => {
  it("leads with Get set up for a new workspace", async () => {
    serve({ members: 0, sender: false, meeting: false });
    renderWithProviders(<WorkspaceHomePage />);
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Welcome to Robotics Club",
      }),
    ).toBeInTheDocument();
    await screen.findByText("No meeting coming up.");
    await screen.findByText(/After your first meeting/);
    expect(headings()).toEqual([
      "Welcome to Robotics Club",
      "Get set up",
      "Next meeting",
      "How it's going",
    ]);
  });

  it("leads with the next meeting once set up, and greets by first name", async () => {
    serve();
    renderWithProviders(<WorkspaceHomePage />);
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Good afternoon, Amira",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: "Weekly sync" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Get set up" })).toBeNull();
    expect(
      await screen.findByText("Robotics Club · 30 members"),
    ).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Often missing" });
    expect(headings()).toEqual([
      "Good afternoon, Amira",
      "Next meeting",
      "How it's going",
      "Often missing",
      "Keep a Google Sheet of every answer",
    ]);
  });

  it("lays out two columns from lg: the meeting and the chart left, who's missing and the Sheets tip right", async () => {
    setWideViewport(true);
    serve();
    const { container } = renderWithProviders(<WorkspaceHomePage />);
    await screen.findByRole("link", { name: "Weekly sync" });
    const main = container.querySelector<HTMLElement>('[data-slot="main"]');
    const side = container.querySelector<HTMLElement>('[data-slot="side"]');
    expect(main).not.toBeNull();
    expect(side).not.toBeNull();
    if (!main || !side) {
      return;
    }
    await within(side).findByRole("heading", { name: "Often missing" });
    expect(
      within(main)
        .getAllByRole("heading")
        .map((heading) => heading.textContent),
    ).toEqual(["Next meeting", "How it's going"]);
    expect(
      within(side)
        .getAllByRole("heading")
        .map((heading) => heading.textContent),
    ).toEqual(["Often missing", "Keep a Google Sheet of every answer"]);
  });

  it("keeps each card's loading and retry to itself", async () => {
    const list = failingOnce({ items: [summary], nextCursor: null });
    serve({ routes: { [LIST]: list } });
    renderWithProviders(<WorkspaceHomePage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Try again" }),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Good afternoon, Amira" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: "Weekly sync" }),
    ).toBeInTheDocument();
    expect(list.calls()).toBe(2);
  });

  it("still shows the next meeting when the insights can't load, and tries them again", async () => {
    // Refused until the person taps Try again: Home must not keep asking by itself.
    let healthy = false;
    let calls = 0;
    serve({
      routes: {
        [INSIGHTS]: () => {
          calls += 1;
          return healthy
            ? new Response(JSON.stringify(insightsFixture))
            : refused();
        },
      },
    });
    renderWithProviders(<WorkspaceHomePage />);
    expect(
      await screen.findByRole("link", { name: "Weekly sync" }),
    ).toBeInTheDocument();
    // Setup and How it's going each offer it; either asks for the same insights.
    const retries = await screen.findAllByRole("button", { name: "Try again" });
    expect(retries).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(calls).toBe(1);
    healthy = true;
    await userEvent.click(retries[0]);
    expect(
      await screen.findByText("Robotics Club · 30 members"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull(),
    );
  });

  it("keeps a period that can't load to How it's going", async () => {
    let allTimeCalls = 0;
    serve({
      routes: {
        [`GET ${base}/insights`]: () => {
          allTimeCalls += 1;
          return refused();
        },
      },
    });
    renderWithProviders(<WorkspaceHomePage />);
    await screen.findByRole("heading", { name: "Often missing" });
    await userEvent.click(screen.getByRole("button", { name: "All time" }));
    expect(
      await screen.findByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(allTimeCalls).toBe(1);
    expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(
      1,
    );
    expect(screen.getByText("Robotics Club · 30 members")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Weekly sync" }),
    ).toBeInTheDocument();
  });

  it("settles when the sender can't load, instead of asking again and again", async () => {
    let senderCalls = 0;
    serve({
      meeting: false,
      routes: {
        [`GET ${base}/sender`]: () => {
          senderCalls += 1;
          return refused();
        },
      },
    });
    renderWithProviders(<WorkspaceHomePage />);
    expect(
      await screen.findByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("No meeting coming up."),
    ).toBeInTheDocument();
    // The no-meeting card mounts after the failure and asks once more (TanStack retries on
    // mount); then Home settles until the person taps Try again.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const settled = senderCalls;
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(senderCalls).toBe(settled);
    expect(senderCalls).toBeLessThanOrEqual(2);
  });

  it("keeps a member's history open when the screen crosses lg", async () => {
    setWideViewport(true);
    const [amira] = insightsFixture.oftenMissing;
    serve({
      routes: {
        [`GET ${base}/contacts/${amira.contactId}/history?${new URLSearchParams({ from: range.from ?? "" })}&limit=50`]:
          json({
            counts: { attending: 0, late: 0, absent: 1, noReply: 1 },
            items: [],
            nextCursor: null,
          }),
      },
    });
    const { container, rerender } = renderWithProviders(<WorkspaceHomePage />);
    await userEvent.click(
      await screen.findByRole("button", { name: new RegExp(amira.fullName) }),
    );
    // It opens on Home's period (the only history address served here).
    const dialog = await screen.findByRole("dialog", { name: amira.fullName });
    expect(
      await within(dialog).findByRole("group", { name: "History" }),
    ).toHaveTextContent("1");

    setWideViewport(false);
    rerender(<WorkspaceHomePage />);

    expect(container.querySelector('[data-slot="side"]')).toBeNull();
    expect(
      screen.getByRole("dialog", { name: amira.fullName }),
    ).toBeInTheDocument();
  });
});
