import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import {
  type AnswerLabels,
  describeAnswer,
} from "@/lib/responses/describe-answer";
import type { InviteeStatus } from "@/shared/api/meetings";
import type {
  AttendanceDetailRow,
  Mark,
  PersonRow,
} from "@/shared/api/responses";

/** Words the rows need (translated by the caller). */
export type ExportText = {
  yes: string;
  noReply: string;
  emailStatus: (status: InviteeStatus) => string;
  /** "Present", "Late", "Absent" (the check-in). */
  actual: (value: Mark["actual"]) => string;
};

/** The two check-in cells: what happened and who marked it (empty without a check-in). */
function checkInCells(text: ExportText, mark: Mark | null): ExportCell[] {
  return mark ? [text.actual(mark.actual), mark.markedByName ?? ""] : ["", ""];
}

/** One export cell. CSV escaping happens later (`toCsv`); rows keep the text as typed. */
export type ExportCell = string | number | null;

/** Each person's list names, in the roster's list order (the "Lists" column). */
export function listNamesByContact(roster: {
  contacts: { id: string; listIds: string[] }[];
  lists: { id: string; name: string }[];
}): Map<string, string[]> {
  return new Map(
    roster.contacts.map((contact) => [
      contact.id,
      roster.lists
        .filter((list) => contact.listIds.includes(list.id))
        .map((list) => list.name),
    ]),
  );
}

const at = (iso: string, timezone: string) =>
  format(new TZDate(iso, timezone), "yyyy-MM-dd HH:mm");

function answerText(
  labels: AnswerLabels,
  text: ExportText,
  answer: PersonRow["answer"],
  emailStatus: InviteeStatus,
): string {
  if (answer) {
    return describeAnswer(labels, answer);
  }
  return emailStatus === "sent" || emailStatus === "unknown"
    ? text.noReply
    : "";
}

/**
 * Meeting answers: Name, Email, Lists, Answer, Late by (min), Reason, Comment, Answered at
 * (meeting zone), After the deadline, Email — one row per invitee.
 */
export function meetingAnswerRows(
  people: PersonRow[],
  listNames: Map<string, string[]>,
  labels: AnswerLabels,
  text: ExportText,
  timezone: string,
): ExportCell[][] {
  return people.map((person) => [
    person.fullName,
    person.email,
    (listNames.get(person.contactId) ?? []).join(", "),
    answerText(labels, text, person.answer, person.emailStatus),
    person.answer?.delayMinutes ?? null,
    person.answer?.reason ?? "",
    person.answer?.comment ?? "",
    person.answer ? at(person.answer.updatedAt, timezone) : "",
    person.answer?.afterDeadline ? text.yes : "",
    text.emailStatus(person.emailStatus),
    ...checkInCells(text, person.mark),
  ]);
}

/** Attendance summary: Name, Email, Lists, Invited, Going, Late, Absent, No reply. */
export function attendanceSummaryRows(
  rows: {
    contactId: string;
    fullName: string;
    email: string;
    invited: number;
    attending: number;
    late: number;
    absent: number;
    noReply: number;
  }[],
  listNames: Map<string, string[]>,
): ExportCell[][] {
  return rows.map((row) => [
    row.fullName,
    row.email,
    (listNames.get(row.contactId) ?? []).join(", "),
    row.invited,
    row.attending,
    row.late,
    row.absent,
    row.noReply,
  ]);
}

/**
 * Attendance details: Meeting, Date (meeting zone), Name, Email, Lists, Answer, Late by (min),
 * Reason, Comment, After the deadline, Email — one row per person per counted meeting.
 */
export function attendanceDetailRows(
  details: AttendanceDetailRow[],
  listNames: Map<string, string[]>,
  labels: AnswerLabels,
  text: ExportText,
): ExportCell[][] {
  return details.map((row) => [
    row.title,
    at(row.startsAt, row.timezone),
    row.fullName,
    row.email,
    (listNames.get(row.contactId) ?? []).join(", "),
    answerText(labels, text, row.answer, row.emailStatus),
    row.answer?.delayMinutes ?? null,
    row.answer?.reason ?? "",
    row.answer?.comment ?? "",
    row.answer?.afterDeadline ? text.yes : "",
    text.emailStatus(row.emailStatus),
    ...checkInCells(text, row.mark),
  ]);
}
