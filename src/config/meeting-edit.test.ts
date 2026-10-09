import { describe, expect, it } from "vitest";
import {
  CALENDAR_FIELDS,
  EDITABLE_FIELDS,
  MEMBER_VISIBLE_FIELDS,
  PLACE_FIELDS,
  SCHEDULE_FIELDS,
} from "./meeting-edit";

describe("edit field groups", () => {
  it("only groups fields that can be edited", () => {
    for (const field of [
      ...MEMBER_VISIBLE_FIELDS,
      ...SCHEDULE_FIELDS,
      ...PLACE_FIELDS,
      ...CALENDAR_FIELDS,
    ]) {
      expect(EDITABLE_FIELDS).toContain(field);
    }
  });

  it("never lets the answer type or the delays change after sending", () => {
    expect(EDITABLE_FIELDS).not.toContain("response_mode");
    expect(EDITABLE_FIELDS).not.toContain("delay_options");
  });
});
