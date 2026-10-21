import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SheetSharing } from "@/shared/api/sheets";
import { renderWithProviders } from "@/test/render";
import { SheetMyAccess } from "./sheet-my-access";

const sharing = (mine: SheetSharing["mine"]): SheetSharing => ({
  teamCount: 2,
  total: 3,
  canView: 1,
  cantOpen: 1,
  inProgress: 1,
  mine,
  myEmail: mine ? "ali@example.test" : null,
});

describe("SheetMyAccess", () => {
  it.each([
    ["shared", "You can view it with ali@example.test."],
    ["sharing", "Sharing it with you…"],
    [
      "refused",
      "You can't open it with ali@example.test. Ask Sara, the Owner, to share it with your Google address.",
    ],
    ["sheet_account", "It's in your Google Drive."],
  ] as const)("says where %s stands", (mine, text) => {
    renderWithProviders(
      <SheetMyAccess sharing={sharing(mine)} ownerName="Sara" />,
    );
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("says nothing without a line of their own", () => {
    renderWithProviders(
      <SheetMyAccess sharing={sharing(null)} ownerName="Sara" />,
    );
    expect(screen.queryByText(/view it|Sharing|Google/)).toBeNull();
  });
});
