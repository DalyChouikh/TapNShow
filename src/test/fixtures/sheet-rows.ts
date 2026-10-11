import type { SheetSourceRow } from "@/lib/sheets/types";

let next = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String((next += 1)).padStart(12, "0")}`;

/** One sheet row for a meeting; override what the test is about. */
export function sheetRow(
  meeting: {
    id: string;
    title?: string;
    startsAt: string;
    status?: "scheduled" | "cancelled";
  },
  overrides: Partial<SheetSourceRow> = {},
): SheetSourceRow {
  return {
    meetingId: meeting.id,
    title: meeting.title ?? "Weekly sync",
    startsAt: meeting.startsAt,
    timezone: "Africa/Tunis",
    responseMode: "attendance",
    meetingStatus: meeting.status ?? "scheduled",
    inviteeId: uuid(),
    contactId: uuid(),
    fullName: "Amira Ben Salah",
    email: "amira@uni.tn",
    emailStatus: "sent",
    answer: null,
    mark: null,
    lists: [],
    ...overrides,
  };
}
