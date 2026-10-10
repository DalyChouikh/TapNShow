import { describe, expect, it } from "vitest";
import { EDITABLE_FIELDS } from "@/config/meeting-edit";
import { toEditColumns } from "./meetings";

describe("toEditColumns", () => {
  it("names the database columns", () => {
    expect(
      toEditColumns({ agendaMd: "x", startsAt: null, reminderGoingHours: 2 }),
    ).toEqual({ agenda_md: "x", starts_at: null, reminder_going_hours: 2 });
  });

  it("only produces editable columns", () => {
    const every = toEditColumns({
      title: "t",
      agendaMd: "a",
      startsAt: null,
      durationMinutes: 60,
      timezone: "Africa/Tunis",
      locationMode: "in_person",
      locationText: "Room",
      onlineText: "",
      meetingUrl: "",
      responseDeadline: null,
      reasonRequired: true,
      commentsEnabled: false,
      footerNote: "",
      reminderPendingHours: 24,
      reminderGoingHours: 2,
    });
    expect(Object.keys(every).sort()).toEqual([...EDITABLE_FIELDS].sort());
  });
});
