import { describe, expect, it } from "vitest";
import { MEMBER_ANSWER_COLUMNS } from "./columns";

describe("MEMBER_ANSWER_COLUMNS", () => {
  it("leaves out other people and sending, keeping the detail order (spec §7.4)", () => {
    expect(MEMBER_ANSWER_COLUMNS.map((column) => column.key)).toEqual([
      "group",
      "meeting",
      "date",
      "answer",
      "lateBy",
      "reason",
      "comment",
      "answeredAt",
      "afterDeadline",
      "checkedIn",
      "wasLateBy",
    ]);
  });
});
