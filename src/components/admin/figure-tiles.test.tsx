import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AdminFigures } from "@/shared/api/admin";
import { figuresFixture, overviewFixture } from "@/test/fixtures/admin";
import { renderWithProviders } from "@/test/render";
import { FigureTiles } from "./figure-tiles";

const zero: AdminFigures = {
  workspacesTotal: 0,
  workspacesNew: 0,
  activeWorkspaces: 0,
  meetingsSent: 0,
  emailsSent: 0,
  emailsFailed: 0,
  answersRateBp: null,
  accountsTotal: 0,
  accountsNew: 0,
  pushesSent: 0,
  pushesFailed: 0,
};

/** The text of the tile labelled `label` (its `<div>` in the definition list). */
function tile(label: string): string {
  const term = screen.getByText(label, { selector: "dt" });
  return term.parentElement?.textContent ?? "";
}

describe("FigureTiles", () => {
  it("shows each figure with its trend, rate or hint", () => {
    renderWithProviders(
      <FigureTiles
        current={overviewFixture.current}
        previous={overviewFixture.previous}
      />,
    );
    expect(tile("Workspaces")).toBe("Workspaces486 new");
    expect(tile("Active")).toBe("Active31sent a meeting");
    expect(tile("Meetings sent")).toBe("Meetings sent214+18%");
    expect(tile("Emails delivered")).toBe(
      "Emails delivered9,87098.7% delivered",
    );
    expect(tile("Answer rate")).toBe("Answer rate71%answered before the start");
    expect(tile("Accounts")).toBe("Accounts62054 new");
    expect(screen.getAllByRole("term")).toHaveLength(6);
  });

  it("marks a drop and a first period", () => {
    const { unmount } = renderWithProviders(
      <FigureTiles
        current={{ ...figuresFixture, meetingsSent: 10 }}
        previous={{ ...figuresFixture, meetingsSent: 20 }}
      />,
    );
    expect(tile("Meetings sent")).toBe("Meetings sent10−50%");
    unmount();
    renderWithProviders(
      <FigureTiles
        current={{ ...figuresFixture, meetingsSent: 4 }}
        previous={{ ...figuresFixture, meetingsSent: 0 }}
      />,
    );
    expect(tile("Meetings sent")).toBe("Meetings sent4new");
  });

  it("shows zeros and no rates on an empty platform", () => {
    renderWithProviders(<FigureTiles current={zero} previous={zero} />);
    expect(tile("Meetings sent")).toBe("Meetings sent0same as before");
    expect(tile("Emails delivered")).toBe("Emails delivered0none sent");
    expect(tile("Answer rate")).toBe("Answer rate–answered before the start");
  });
});
