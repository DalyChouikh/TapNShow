import { describe, expect, it } from "vitest";
import messages from "../../../messages/en.json";
import { sheetRow } from "@/test/fixtures/sheet-rows";
import { planYearTabs, resolveTitle } from "./tabs";
import { sheetWords } from "./words";

const words = sheetWords("en", messages);
const meeting = (id: string, startsAt: string, people: number) =>
  Array.from({ length: people }, () => sheetRow({ id, startsAt }));

describe("planYearTabs", () => {
  it("keeps a year under the cap in one tab named by the year", () => {
    const rows = [
      ...meeting("m2", "2026-10-15T17:00:00Z", 3),
      ...meeting("m1", "2026-10-08T17:00:00Z", 2),
    ];
    const tabs = planYearTabs(2026, rows, {
      maxRows: 10,
      currentYear: 2026,
      words,
    });
    expect(tabs.map((tab) => [tab.key, tab.title, tab.rows.length])).toEqual([
      ["2026", "2026", 5],
    ]);
    expect(tabs[0].startsTo).toBe("2026-10-15T17:00:00Z");
    expect(tabs[0].startsFrom).toBe("2026-10-08T17:00:00Z");
  });

  it("splits a big year at meeting boundaries, newest chunk first, named by its days", () => {
    const rows = [
      ...meeting("m3", "2026-04-28T17:00:00Z", 4),
      ...meeting("m2", "2026-02-10T17:00:00Z", 4),
      ...meeting("m1", "2026-01-03T17:00:00Z", 4),
    ];
    const tabs = planYearTabs(2026, rows, {
      maxRows: 8,
      currentYear: 2026,
      words,
    });
    expect(tabs.map((tab) => [tab.key, tab.title, tab.rows.length])).toEqual([
      ["2026-1", "2026 · 10 Feb – 28 Apr", 8],
      ["2026-2", "2026 · 3 Jan – 3 Jan", 4],
    ]);
  });

  it("never splits one meeting, even when it alone is over the cap", () => {
    const tabs = planYearTabs(2026, meeting("m1", "2026-03-01T17:00:00Z", 12), {
      maxRows: 8,
      currentYear: 2026,
      words,
    });
    expect(tabs.map((tab) => tab.rows.length)).toEqual([12]);
  });

  it("keeps an empty current-year tab, and drops an empty past year", () => {
    expect(
      planYearTabs(2026, [], { maxRows: 8, currentYear: 2026, words }).map(
        (tab) => tab.key,
      ),
    ).toEqual(["2026"]);
    expect(
      planYearTabs(2025, [], { maxRows: 8, currentYear: 2026, words }),
    ).toEqual([]);
  });
});

describe("resolveTitle", () => {
  it("leaves a title alone unless someone else's tab already has it", () => {
    expect(resolveTitle("2026", new Set(["Summary"]), words)).toBe("2026");
    expect(resolveTitle("2026", new Set(["2026"]), words)).toBe(
      "2026 (TapNShow)",
    );
  });
});
