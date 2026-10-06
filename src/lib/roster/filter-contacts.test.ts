import { describe, expect, it } from "vitest";
import { IDS, rosterFixture } from "@/test/fixtures/roster";
import {
  filterContacts,
  NO_LIST,
  normalizeForSearch,
  type ListFilter,
} from "./filter-contacts";

const names = (query: string, listId: ListFilter = null): string[] =>
  filterContacts(rosterFixture.contacts, { query, listId }).map(
    (c) => c.fullName,
  );

describe("filterContacts", () => {
  it("ignores accents and case, and searches names and emails", () => {
    expect(normalizeForSearch("  Inès BEN ")).toBe("ines ben");
    expect(names("ines")).toEqual(["Inès Ben Salah"]);
    expect(names("Y@EXAMPLE")).toEqual(["Youssef Trabelsi"]);
    expect(names("")).toHaveLength(3);
  });

  it("filters by list, alone and with a query", () => {
    expect(names("", IDS.dev)).toEqual(["Inès Ben Salah", "Sarra Khelifi"]);
    expect(names("sarra", IDS.dev)).toEqual(["Sarra Khelifi"]);
    expect(names("", IDS.design)).toEqual(["Sarra Khelifi"]);
  });

  it("finds people who are in no list", () => {
    expect(names("", NO_LIST)).toEqual(["Youssef Trabelsi"]);
  });
});
