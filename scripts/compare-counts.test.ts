import { describe, expect, it } from "vitest";
import { compareCounts } from "./compare-counts";

describe("compareCounts", () => {
  it("passes when every table has the same row count", () => {
    expect(
      compareCounts(
        "public.contacts|30\npublic.lists|2\n",
        "public.contacts|30\npublic.lists|2",
      ),
    ).toEqual([]);
  });

  it("names each table that differs or is missing", () => {
    expect(
      compareCounts("public.contacts|30\npublic.lists|2", "public.contacts|29"),
    ).toEqual([
      "public.contacts: 30 before, 29 after",
      "public.lists: 2 before, missing after",
    ]);
  });

  it("fails an empty dump (a broken query must not look like success)", () => {
    expect(compareCounts("", "")).toEqual(["no tables counted"]);
  });
});
