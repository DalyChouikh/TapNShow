import { describe, expect, it } from "vitest";
import messages from "../../../messages/en.json";
import { EXPORT_COLORS } from "@/lib/export/theme";
import { sheetRow } from "@/test/fixtures/sheet-rows";
import { tabContent } from "./content";
import {
  formatRequests,
  redrawRequests,
  SHEET_COLUMNS,
  SHEET_RULE_COUNT,
} from "./requests";
import { planYearTabs } from "./tabs";
import { sheetWords } from "./words";

const words = sheetWords("en", messages);
const [tab] = planYearTabs(
  2026,
  [sheetRow({ id: "m1", startsAt: "2026-10-15T17:00:00Z" })],
  { maxRows: 10, currentYear: 2026, words },
);
const content = tabContent(tab, {
  workspaceName: "Robotics Club",
  updatedAt: new Date("2026-10-12T21:15:00Z"),
  timezone: "Africa/Tunis",
  words,
});

describe("redrawRequests", () => {
  const requests = redrawRequests(42, "2026", content, 77);

  it("sets the exact row count (header rows plus at least one row), freezes the header", () => {
    expect(requests[0]).toEqual({
      updateSheetProperties: {
        properties: {
          sheetId: 42,
          title: "2026",
          gridProperties: {
            rowCount: 5,
            columnCount: SHEET_COLUMNS,
            frozenRowCount: 4,
          },
        },
        fields: "title,gridProperties(rowCount,columnCount,frozenRowCount)",
      },
    });
  });

  it("writes values only, as text or numbers, with the helpers last", () => {
    const write = requests.find((request) => "updateCells" in request);
    expect(JSON.stringify(write)).toContain('"fields":"userEnteredValue"');
    expect(JSON.stringify(write)).toContain(
      '{"userEnteredValue":{"stringValue":"Weekly sync · Thu 15 Oct"}}',
    );
    expect(JSON.stringify(write)).toContain(
      '{"userEnteredValue":{"stringValue":"even"}}',
    );
    expect(JSON.stringify(write)).not.toContain("formulaValue");
  });

  it("moves the Meeting filter box's range to the exact last row (S6: a slicer's range does not grow)", () => {
    expect(requests).toContainEqual({
      updateSlicerSpec: {
        slicerId: 77,
        spec: {
          dataRange: {
            sheetId: 42,
            startRowIndex: 3,
            endRowIndex: 5,
            startColumnIndex: 0,
            endColumnIndex: 15,
          },
        },
        fields: "dataRange",
      },
    });
  });
});

describe("formatRequests", () => {
  it("replaces old rules and slicers, then adds tone rules before band rules and one slicer", () => {
    const requests = formatRequests(
      42,
      { conditionalFormats: 2, slicerIds: [7] },
      words,
      77,
    );
    const kinds = requests.map((request) => Object.keys(request)[0]);
    expect(kinds.slice(0, 3)).toEqual([
      "deleteConditionalFormatRule",
      "deleteConditionalFormatRule",
      "deleteEmbeddedObject",
    ]);
    const rules = requests
      .filter((request) => "addConditionalFormatRule" in request)
      .map((request) => JSON.stringify(request));
    expect(rules[0]).toContain('=$Q5=\\"success\\"');
    expect(rules.at(-1)).toContain('=$P5=\\"cancelled\\"');
    // S6: the lowest index wins, so the indexes follow the request order (tones first).
    const indexes = requests.flatMap((request) =>
      "addConditionalFormatRule" in request
        ? [JSON.stringify(request).match(/"index":(\d+)/)?.[1]]
        : [],
    );
    expect(indexes).toEqual(rules.map((_, index) => String(index)));
    expect(kinds.filter((kind) => kind === "addSlicer")).toHaveLength(1);
    expect(JSON.stringify(requests)).toContain('"slicerId":77');
    expect(JSON.stringify(requests)).toContain(
      String(
        Math.round(
          (parseInt(EXPORT_COLORS.primary.slice(1, 3), 16) / 255) * 1000,
        ) / 1000,
      ),
    );
  });
});

describe("SHEET_RULE_COUNT", () => {
  it("is how many colour rules formatRequests adds (a tab with fewer lost some)", () => {
    expect(
      formatRequests(
        1,
        { conditionalFormats: 0, slicerIds: [] },
        words,
        2,
      ).filter((request) => "addConditionalFormatRule" in request),
    ).toHaveLength(SHEET_RULE_COUNT);
  });
});
