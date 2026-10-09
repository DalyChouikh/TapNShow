import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { setWideViewport } from "@/test/match-media";
import { renderWithProviders } from "@/test/render";
import type { Roster } from "@/shared/api/roster";
import { AttendanceView } from "./attendance-view";

const LIST = "7a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6a1";
const ids = ["1", "2", "3"].map(
  (n) => `6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6a${n}`,
);
const roster = {
  contacts: [
    {
      id: ids[0],
      fullName: "Amira B.",
      email: "a@uni.tn",
      listIds: [LIST],
      unsubscribed: false,
      reported: false,
    },
    {
      id: ids[1],
      fullName: "Omar D.",
      email: "o@uni.tn",
      listIds: [],
      unsubscribed: false,
      reported: false,
    },
    {
      id: ids[2],
      fullName: "Youssef K.",
      email: "y@uni.tn",
      listIds: [LIST],
      unsubscribed: false,
      reported: false,
    },
  ],
  lists: [{ id: LIST, name: "Design", contactCount: 2 }],
  limits: { contactsMax: 2000, listsMax: 50, importRowsMax: 2000 },
} satisfies Roster;
const summary = {
  meetings: 4,
  rows: [
    {
      contactId: ids[0],
      invited: 4,
      attending: 1,
      late: 3,
      absent: 0,
      noReply: 0,
    },
    {
      contactId: ids[1],
      invited: 4,
      attending: 0,
      late: 0,
      absent: 1,
      noReply: 3,
    },
    {
      contactId: ids[2],
      invited: 4,
      attending: 4,
      late: 0,
      absent: 0,
      noReply: 0,
    },
  ],
};

function setup() {
  routeFetch(
    new Proxy({}, { get: () => () => new Response(JSON.stringify(summary)) }),
  );
  const onOpen = vi.fn();
  renderWithProviders(
    <AttendanceView
      workspace={workspaceFixture}
      roster={roster}
      onOpenContact={onOpen}
    />,
  );
  return onOpen;
}

afterEach(() => setWideViewport(false));

describe("AttendanceView", () => {
  it("sorts by No reply first and opens a person", async () => {
    const onOpen = setup();
    expect(
      await screen.findByText("4 meetings in this period"),
    ).toBeInTheDocument();
    const rows = screen.getAllByRole("button", { name: /\./ });
    expect(rows[0]).toHaveTextContent("Omar D.");
    fireEvent.click(rows[0]);
    expect(onOpen).toHaveBeenCalledWith(roster.contacts[1]);
  });

  it("narrows to a list", async () => {
    setup();
    await screen.findByText("4 meetings in this period");
    fireEvent.click(screen.getByRole("button", { name: /Design/ }));
    expect(screen.queryByText("Omar D.")).toBeNull();
    expect(screen.getByText("Amira B.")).toBeInTheDocument();
  });

  it("sorts by a column header on wide screens", async () => {
    setWideViewport(true);
    setup();
    const table = await screen.findByRole("table");
    const late = within(table).getByRole("button", { name: "Late" });
    fireEvent.click(late);
    expect(late.closest("th")).toHaveAttribute("aria-sort", "descending");
    const firstRow = within(table).getAllByRole("row")[1];
    expect(firstRow).toHaveTextContent("Amira B.");
  });
});
