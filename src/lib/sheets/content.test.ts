import { describe, expect, it } from "vitest";
import messages from "../../../messages/en.json";
import { sheetRow } from "@/test/fixtures/sheet-rows";
import { contentFingerprint, tabContent } from "./content";
import { planYearTabs } from "./tabs";
import { sheetWords } from "./words";

const words = sheetWords("en", messages);
const answer = (
  status: "attending" | "late" | "absent",
  delayMinutes: number | null = null,
) => ({
  status,
  delayMinutes,
  reason: status === "absent" ? "Exam" : "",
  comment: "",
  afterDeadline: false,
  updatedAt: "2026-10-12T09:00:00.000Z",
  needsReconfirmation: false,
});

function build(rows: Parameters<typeof planYearTabs>[1]) {
  const [tab] = planYearTabs(2026, rows, {
    maxRows: 100,
    currentYear: 2026,
    words,
  });
  return {
    tab,
    content: tabContent(tab, {
      workspaceName: "Robotics Club",
      updatedAt: new Date("2026-10-12T21:15:00.000Z"),
      timezone: "Africa/Tunis",
      words,
    }),
  };
}

describe("tabContent", () => {
  it("names the band, the update time and the columns like the Excel Details sheet", () => {
    const { content } = build([
      sheetRow({ id: "m1", startsAt: "2026-10-15T17:00:00Z" }),
    ]);
    expect(content.band).toBe("Robotics Club · Responses 2026");
    expect(content.subtitle).toBe(
      "Updated Mon 12 Oct, 22:15 · Changes made here are replaced by TapNShow",
    );
    expect(content.header).toHaveLength(15);
    expect(content.header[0]).toBe("Meeting");
    expect(content.header[9]).toBe("Answered at");
  });

  it("puts the date in the meeting cell, bands meetings in turn, greys a cancelled one", () => {
    const { content } = build([
      sheetRow({ id: "m3", startsAt: "2026-10-15T17:00:00Z" }),
      sheetRow({
        id: "m2",
        startsAt: "2026-10-08T13:00:00Z",
        status: "cancelled",
        title: "Flutter workshop",
      }),
      sheetRow({ id: "m1", startsAt: "2026-10-01T17:00:00Z" }),
    ]);
    expect(content.values.map((row) => row[0])).toEqual([
      "Weekly sync · Thu 15 Oct",
      "Flutter workshop · Thu 8 Oct · Cancelled",
      "Weekly sync · Thu 1 Oct",
    ]);
    expect(content.helpers.map((helper) => helper[0])).toEqual([
      "even",
      "cancelled",
      "even",
    ]);
  });

  it("writes tints as text and their tones in the helper columns", () => {
    const { content } = build([
      sheetRow(
        { id: "m1", startsAt: "2026-10-15T17:00:00Z" },
        { answer: answer("late", 15) },
      ),
      sheetRow(
        { id: "m1", startsAt: "2026-10-15T17:00:00Z" },
        {
          answer: answer("absent"),
          mark: {
            actual: "absent",
            markedAt: "2026-10-15T18:00:00Z",
            markedByName: "Daly",
            lateMinutes: null,
          },
        },
      ),
      sheetRow({ id: "m1", startsAt: "2026-10-15T17:00:00Z" }),
    ]);
    expect(content.values.map((row) => row[5])).toEqual([
      "Late by 15 min",
      "Can't come",
      "No reply",
    ]);
    expect(content.helpers).toEqual([
      ["even", "warning", ""],
      ["even", "danger", "danger"],
      ["even", "neutral", ""],
    ]);
  });

  it("keeps text that looks like a formula as plain text", () => {
    const { content } = build([
      sheetRow(
        { id: "m1", startsAt: "2026-10-15T17:00:00Z" },
        { fullName: '=HYPERLINK("x")' },
      ),
    ]);
    expect(content.values[0][2]).toBe('=HYPERLINK("x")');
  });

  it("fingerprints the content without the update time", () => {
    const rows = [sheetRow({ id: "m1", startsAt: "2026-10-15T17:00:00Z" })];
    const first = build(rows);
    const later = tabContent(first.tab, {
      workspaceName: "Robotics Club",
      updatedAt: new Date("2026-10-13T08:00:00Z"),
      timezone: "Africa/Tunis",
      words,
    });
    expect(contentFingerprint(first.tab, later)).toBe(
      contentFingerprint(first.tab, first.content),
    );
  });
});
