import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SheetTeamCounts } from "@/shared/api/sheets";
import { renderWithProviders } from "@/test/render";
import { SheetTeamAccess } from "./sheet-team-access";

const team = (over: Partial<SheetTeamCounts> = {}): SheetTeamCounts => ({
  teamCount: 4,
  total: 5,
  canView: 5,
  cantOpen: 0,
  inProgress: 0,
  ...over,
});
const FOLLOWS =
  "People who join or leave the team get or lose access within a minute.";

describe("SheetTeamAccess", () => {
  it("says the whole team can view it, in green", () => {
    renderWithProviders(<SheetTeamAccess team={team()} />);
    expect(screen.getByText("Shared")).toHaveClass("bg-fill-success");
    expect(
      screen.getByText("Your team can view it · 5 of 5 people"),
    ).toBeInTheDocument();
    expect(screen.getByText(FOLLOWS)).toBeInTheDocument();
    expect(screen.queryByText(/can't open it/)).toBeNull();
  });

  it("says it is still sharing while some people wait", () => {
    renderWithProviders(
      <SheetTeamAccess team={team({ canView: 3, inProgress: 2 })} />,
    );
    expect(screen.getByText("Sharing…")).toHaveClass("bg-fill-info");
    expect(
      screen.getByText("Your team can view it · 3 of 5 people"),
    ).toBeInTheDocument();
  });

  it("counts who can't open it, never naming anyone, and points to People", () => {
    const { rerender } = renderWithProviders(
      <SheetTeamAccess team={team({ canView: 4, cantOpen: 1 })} />,
    );
    expect(screen.getByText("Shared")).toHaveClass("bg-fill-warning");
    expect(
      screen.getByText(
        "1 person on your team can't open it. You can share it with them by hand from Google Sheets.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "They're marked in People." }),
    ).toHaveAttribute("href", "#people");
    rerender(<SheetTeamAccess team={team({ canView: 0, cantOpen: 5 })} />);
    expect(
      screen.getByText(/^5 people on your team can't open it\./),
    ).toBeInTheDocument();
  });

  it("tells an Owner alone that people who join get access", () => {
    renderWithProviders(
      <SheetTeamAccess team={team({ teamCount: 0, total: 0, canView: 0 })} />,
    );
    expect(
      screen.getByText("Only you so far. People who join the team get access."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Shared")).toBeNull();
    expect(screen.queryByText(FOLLOWS)).toBeNull();
  });
});
