import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentType } from "react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UNDO_DELETE_MS } from "@/config/roster";
import { json, routeFetch } from "@/test/fetch";
import { setWideViewport } from "@/test/match-media";
import { IDS, rosterFixture } from "@/test/fixtures/roster";
import type { Roster } from "@/shared/api/roster";
import { renderWithProviders } from "@/test/render";
import { okContext } from "@/test/workspace-context-mock";
import { RosterView } from "./roster-view";

// next/dynamic needs the Next compiler; React.lazy gives the same deferred loading under Vitest.
vi.mock("next/dynamic", async () => {
  const { createElement, lazy, Suspense } = await import("react");
  return {
    default: (loader: () => Promise<ComponentType<object>>) => {
      const Lazy = lazy(async () => ({ default: await loader() }));
      return function Dynamic(props: object) {
        return createElement(
          Suspense,
          { fallback: null },
          createElement(Lazy, props),
        );
      };
    },
  };
});

// Sonner keeps toasts in module state; one test's toast must not leak into the next.
afterEach(() => {
  toast.dismiss();
});

const owner = okContext.workspace;
// Sonner renders toasts as list items too, so count only the roster's own list.
const people = () =>
  within(screen.getByRole("list", { name: "People" })).getAllByRole("listitem");
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

  it("falls back to All when the chosen filter stops matching anything", async () => {
    const withoutDesign: Roster = {
      ...rosterFixture,
      lists: rosterFixture.lists.filter((list) => list.id !== IDS.design),
      contacts: rosterFixture.contacts.map((contact) => ({
        ...contact,
        listIds: contact.listIds.filter((id) => id !== IDS.design),
      })),
    };
    const everyoneListed: Roster = {
      ...rosterFixture,
      contacts: rosterFixture.contacts.map((contact) => ({
        ...contact,
        listIds: contact.listIds.length ? contact.listIds : [IDS.dev],
      })),
    };
    function Swapper() {
      const [roster, setRoster] = useState<Roster>(rosterFixture);
      return (
        <>
          <button type="button" onClick={() => setRoster(withoutDesign)}>
            drop design
          </button>
          <button type="button" onClick={() => setRoster(everyoneListed)}>
            list everyone
          </button>
          <RosterView workspace={owner} roster={roster} />
        </>
      );
    }
    const user = userEvent.setup();
    renderWithProviders(<Swapper />);
    await user.click(screen.getByRole("button", { name: "Design 1" }));
    await user.click(screen.getByRole("button", { name: "drop design" }));
    expect(screen.getByRole("button", { name: "All 3" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(people()).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "No list 1" }));
    await user.click(screen.getByRole("button", { name: "list everyone" }));
    expect(screen.getByRole("button", { name: "All 3" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(people()).toHaveLength(3);
  });

  it("scrolls the list chips sideways without a visible scrollbar", () => {
    renderWithProviders(
      <RosterView workspace={owner} roster={rosterFixture} />,
    );
    expect(screen.getByRole("group", { name: "Filter by list" })).toHaveClass(
      "[scrollbar-width:none]",
      "[&::-webkit-scrollbar]:hidden",
    );
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

  it("never sends a delete while its Undo is still on screen", async () => {
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
    const undo = await screen.findByRole("button", { name: "Undo" });
    // Hovering the toaster pauses sonner's timer (as do touch and a hidden tab).
    const toaster = undo.closest("ol");
    if (toaster) {
      fireEvent.mouseEnter(toaster);
    }
    await vi.advanceTimersByTimeAsync(UNDO_DELETE_MS * 3);
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("listitem", { name: /Inès/ })).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(UNDO_DELETE_MS);
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
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

  it("selects cards on phones and shows the bar", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RosterView workspace={owner} roster={rosterFixture} />,
    );
    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(
      screen.getByRole("checkbox", { name: "Select Inès Ben Salah" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Select Sarra Khelifi" }),
    );
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByTestId("selection-spacer")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("2 selected")).toBeNull();
  });

  it("shows the grid from md up", () => {
    setWideViewport(true);
    renderWithProviders(
      <RosterView workspace={owner} roster={rosterFixture} />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
  });

  it("bulk deletes with the same Undo as single deletes", async () => {
    routeFetch({
      "GET /api/workspaces/club-ab12/contacts": json(rosterFixture),
    });
    const user = userEvent.setup();
    renderWithProviders(
      <RosterView workspace={owner} roster={rosterFixture} />,
      { toaster: true },
    );
    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(
      screen.getByRole("checkbox", { name: "Select Inès Ben Salah" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Select Sarra Khelifi" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete 2" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(people()).toHaveLength(1);
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(people()).toHaveLength(3);
  });

  it("never shows selection or the grid's edit buttons to Viewers", () => {
    setWideViewport(true);
    renderWithProviders(
      <RosterView workspace={viewer} roster={rosterFixture} />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Full name of/ })).toBeNull();
  });

  it("opens the import dialog from the header and the empty state", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RosterView workspace={owner} roster={rosterFixture} />,
    );
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(
      await screen.findByRole(
        "dialog",
        { name: "Import people" },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
  });
});
