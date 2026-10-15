import { describe, expect, it } from "vitest";
import { exportFileName } from "./file-name";

describe("exportFileName", () => {
  it("joins slugged parts with the date", () => {
    expect(
      exportFileName(
        ["robotics-club", "Weekly sync: été!", "answers"],
        "csv",
        new Date("2026-10-08T12:00:00Z"),
      ),
    ).toBe("robotics-club-weekly-sync-ete-answers-2026-10-08.csv");
  });

  it("drops empty parts", () => {
    expect(
      exportFileName(
        ["club", "", "attendance"],
        "xlsx",
        new Date("2026-10-08T12:00:00Z"),
      ),
    ).toBe("club-attendance-2026-10-08.xlsx");
  });
});
