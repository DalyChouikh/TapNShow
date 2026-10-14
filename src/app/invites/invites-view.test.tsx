import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEVICE_KEYS } from "@/config/members";
import type { MyInvite } from "@/shared/api/my-invites";
import { json, type FetchRoute, routeFetch } from "@/test/fetch";
import { meFixture } from "@/test/fixtures/me";
import { myInviteFixture, myInvitesPage } from "@/test/fixtures/my-invites";
import { renderWithProviders } from "@/test/render";
import { InvitesView } from "./invites-view";

const net = vi.hoisted(() => ({ online: true }));
vi.mock("@/hooks/use-online", () => ({ useOnline: () => net.online }));

// Wednesday 14 Oct 2026, 12:00 UTC.
const NOW = new Date("2026-10-14T12:00:00.000Z");
const invite = (
  title: string,
  startsAt: string,
  needsAnswer = true,
): MyInvite => ({
  ...myInviteFixture,
  inviteeId: crypto.randomUUID(),
  title,
  startsAt,
  needsAnswer,
});
const thisWeek = invite("Friday sync", "2026-10-16T17:00:00.000Z");
const nextWeek = invite("Next sync", "2026-10-20T17:00:00.000Z", false);
const later = invite("Far sync", "2026-11-03T17:00:00.000Z");
const PAGE = "GET /api/me/invites?tab=upcoming&filter=all&limit=50";
const NEEDS = "GET /api/me/invites?tab=upcoming&filter=needs&limit=50";
const PAST = "GET /api/me/invites?tab=past&filter=all&limit=50";

function serve(routes: Record<string, FetchRoute>) {
  return routeFetch({ "GET /api/me": json(meFixture), ...routes });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  window.localStorage.clear();
  net.online = true;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("InvitesView", () => {
  it("groups Upcoming by week", async () => {
    serve({ [PAGE]: json(myInvitesPage([thisWeek, nextWeek, later])) });
    renderWithProviders(<InvitesView />);
    expect(await screen.findByText("Friday sync")).toBeVisible();
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(["This week", "Next week", "Later"]);
  });

  it("counts what needs an answer, filters to it and remembers the chip on this device", async () => {
    const fetchMock = serve({
      [PAGE]: json(myInvitesPage([thisWeek, nextWeek, later])),
      [NEEDS]: json(myInvitesPage([thisWeek, later])),
    });
    const user = userEvent.setup();
    renderWithProviders(<InvitesView />);
    const needs = await screen.findByRole("button", {
      name: "Needs your answer 2",
    });
    await user.click(needs);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(NEEDS.slice(4), expect.anything()),
    );
    expect(window.localStorage.getItem(DEVICE_KEYS.invitesFilter)).toBe(
      "needs",
    );
  });

  it("starts on the chip remembered on this device", async () => {
    window.localStorage.setItem(DEVICE_KEYS.invitesFilter, "needs");
    serve({
      [PAGE]: json(myInvitesPage([thisWeek])),
      [NEEDS]: json(myInvitesPage([], { needsCount: 0 })),
    });
    renderWithProviders(<InvitesView />);
    expect(await screen.findByText("You're all caught up")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Needs your answer" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("explains an empty list with the address and offers a workspace", async () => {
    serve({ [PAGE]: json(myInvitesPage([])) });
    renderWithProviders(<InvitesView />);
    expect(await screen.findByText("No invites yet")).toBeVisible();
    expect(
      screen.getByText(
        "When a group invites you at amira@example.test, the meeting shows up here too.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Create a workspace" }),
    ).toHaveAttribute("href", "/w/new");
  });

  it("has no chips on Past", async () => {
    serve({
      [PAGE]: json(myInvitesPage([thisWeek])),
      [PAST]: json(myInvitesPage([])),
    });
    const user = userEvent.setup();
    renderWithProviders(<InvitesView />);
    await screen.findByText("Friday sync");
    await user.click(screen.getByRole("radio", { name: "Past" }));
    expect(await screen.findByText("No past invites yet.")).toBeVisible();
    expect(screen.queryByRole("group", { name: "Show" })).toBeNull();
  });

  it("offline: says how old the list is, and cards can't be opened", async () => {
    net.online = false;
    serve({ [PAGE]: json(myInvitesPage([thisWeek])) });
    renderWithProviders(<InvitesView />);
    expect(await screen.findByText("Friday sync")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "You're offline. Showing your invites from",
    );
    expect(screen.queryByRole("link", { name: /Friday sync/ })).toBeNull();
    expect(screen.getByText("Connect to answer")).toBeVisible();
  });

  it("offline with nothing saved: asks to connect", async () => {
    net.online = false;
    serve({
      [PAGE]: async () => Promise.reject(new TypeError("Failed to fetch")),
    });
    renderWithProviders(<InvitesView />);
    expect(
      await screen.findByText("Connect to see your invites."),
    ).toBeVisible();
  });

  it("offline with an empty saved list: the usual empty state, not 'connect'", async () => {
    net.online = false;
    serve({
      "GET /api/me": async () =>
        Promise.reject(new TypeError("Failed to fetch")),
      [PAGE]: json(myInvitesPage([])),
    });
    renderWithProviders(<InvitesView />);
    expect(await screen.findByText("No invites yet")).toBeVisible();
    expect(screen.queryByText("Connect to see your invites.")).toBeNull();
    // Offline, the profile (and its address) isn't saved: the sentence goes without it.
    expect(
      screen.getByText(
        "When a group invites you, the meeting shows up here too.",
      ),
    ).toBeVisible();
  });
});
