import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UNDO_DELETE_MS } from "@/config/roster";
import { json, routeFetch } from "@/test/fetch";
import { IDS, rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { okContext } from "@/test/workspace-context-mock";
import { RosterView } from "./roster-view";

const owner = okContext.workspace;
const viewer = { ...owner, myRole: "viewer" as const };

describe("RosterView", () => {
  it("lists people as cards with their lists and a count", () => {
    renderWithProviders(
      <RosterView workspace={owner} roster={rosterFixture} />,
    );
    expect(screen.getByRole("heading", { name: "Lists" })).toBeInTheDocument();
    expect(screen.getByText("3 people")).toBeInTheDocument();
    const ines = screen.getByRole("listitem", { name: /Inès Ben Salah/ });
    expect(within(ines).getByText("ines@example.com")).toBeInTheDocument();
    expect(within(ines).getByText("Dev")).toBeInTheDocument();
  });

  it("searches without accents and filters by a list chip", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RosterView workspace={owner} roster={rosterFixture} />,
    );
    await user.type(
      screen.getByRole("searchbox", { name: "Search people" }),
      "ines",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    await user.clear(screen.getByRole("searchbox", { name: "Search people" }));
    await user.click(screen.getByRole("button", { name: "Design 1" }));
    expect(
      screen
        .getAllByRole("listitem")
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual([expect.stringContaining("Sarra Khelifi")]);
    await user.click(screen.getByRole("button", { name: "All 3" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("offers a No list chip only when someone has no list", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(
      <RosterView workspace={owner} roster={rosterFixture} />,
    );
    await user.click(screen.getByRole("button", { name: "No list 1" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    unmount();
    const everyoneListed = {
      ...rosterFixture,
      contacts: rosterFixture.contacts.map((contact) => ({
        ...contact,
        listIds: [rosterFixture.lists[0].id],
      })),
    };
    renderWithProviders(
      <RosterView workspace={owner} roster={everyoneListed} />,
    );
    expect(screen.queryByRole("button", { name: /^No list/ })).toBeNull();
  });

  it("says when nobody matches", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RosterView workspace={owner} roster={rosterFixture} />,
    );
    await user.type(
      screen.getByRole("searchbox", { name: "Search people" }),
      "zzz",
    );
    expect(screen.getByText("Nobody matches your search.")).toBeInTheDocument();
  });

  it("shows the empty roster differently to organizers and Viewers", () => {
    const empty = { ...rosterFixture, contacts: [], lists: [] };
    const { unmount } = renderWithProviders(
      <RosterView workspace={owner} roster={empty} />,
    );
    expect(
      screen.getByRole("heading", { name: "Import your roster" }),
    ).toBeInTheDocument();
    unmount();
    renderWithProviders(<RosterView workspace={viewer} roster={empty} />);
    expect(
      screen.getByRole("heading", { name: "No one here yet" }),
    ).toBeInTheDocument();
  });

  it("deletes with Undo: hidden at once, restored by Undo, sent only after the delay", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = routeFetch({
      [`DELETE /api/workspaces/club-ab12/contacts/${IDS.ines}`]: json({
        ok: true,
      }),
      "GET /api/workspaces/club-ab12/contacts": json(rosterFixture),
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(
      <RosterView workspace={owner} roster={rosterFixture} />,
      { toaster: true },
    );

    await user.click(screen.getByRole("button", { name: /Inès Ben Salah/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("listitem", { name: /Inès/ })).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(screen.getByRole("listitem", { name: /Inès/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Inès Ben Salah/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
    await vi.advanceTimersByTimeAsync(UNDO_DELETE_MS);
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(true);
    vi.useRealTimers();
  });

  it("lets organizers add people and manage lists, not Viewers", () => {
    const { unmount } = renderWithProviders(
      <RosterView workspace={owner} roster={rosterFixture} />,
    );
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage" })).toBeInTheDocument();
    unmount();
    renderWithProviders(
      <RosterView workspace={viewer} roster={rosterFixture} />,
    );
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage" })).toBeNull();
  });
});
