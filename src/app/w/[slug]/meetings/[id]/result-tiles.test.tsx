import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { resultsFixture } from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import { ResultTiles } from "./result-tiles";

const results = {
  ...resultsFixture,
  answers: {
    attending: 17,
    late: 4,
    absent: 3,
    notAttending: 0,
    noReply: 6,
    calendarRequested: 0,
  },
};

describe("ResultTiles", () => {
  it("shows four attendance tiles that filter, and a second tap clears", () => {
    const onFilter = vi.fn();
    const first = renderWithProviders(
      <ResultTiles results={results} filter="all" onFilter={onFilter} />,
    );
    for (const name of ["Going 17", "Late 4", "Absent 3", "No reply 6"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
    fireEvent.click(screen.getByRole("button", { name: "Late 4" }));
    expect(onFilter).toHaveBeenLastCalledWith("late");
    first.unmount();
    renderWithProviders(
      <ResultTiles results={results} filter="late" onFilter={onFilter} />,
    );
    expect(screen.getByRole("button", { name: "Late 4" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Late 4" }));
    expect(onFilter).toHaveBeenLastCalledWith("all");
  });

  it("shows Going / Not going / No reply for RSVP", () => {
    renderWithProviders(
      <ResultTiles
        results={{
          ...results,
          responseMode: "rsvp",
          answers: { ...results.answers, notAttending: 2 },
        }}
        filter="all"
        onFilter={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: "Not going 2" }),
    ).toBeInTheDocument();
  });

  it("shows only the calendar requests for an announcement", () => {
    renderWithProviders(
      <ResultTiles
        results={{
          ...results,
          responseMode: "announcement",
          answers: { ...results.answers, calendarRequested: 5 },
        }}
        filter="all"
        onFilter={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen.getByText("5 people asked for a calendar invite."),
    ).toBeInTheDocument();
  });
});
