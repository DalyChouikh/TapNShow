import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import type { FillTone } from "@/design/tokens";
import {
  type AnswerLabels,
  describeAnswer,
} from "@/lib/responses/describe-answer";
import { ACTUAL_TONE, ANSWER_TONE } from "@/lib/responses/tones";
import type { InviteeStatus } from "@/shared/api/meetings";
import type {
  AttendanceDetailRow,
  Mark,
  PersonRow,
} from "@/shared/api/responses";
import type { MyAnswer } from "@/shared/api/my-invites";

/** Words the rows need (translated by the caller). */
export type ExportText = {
  yes: string;
  noReply: string;
  emailStatus: (status: InviteeStatus) => string;
  /** "Present", "Late", "Absent" (the check-in). */
  actual: (value: Mark["actual"]) => string;
};

/** The tinted "Checked in" cell (Present / Late / Absent), empty without a check-in. */
function checkInCell(
  text: ExportText,
  actual: Mark["actual"] | undefined,
): TintedCell | "" {
  return actual ? { text: text.actual(actual), tone: ACTUAL_TONE[actual] } : "";
}

/**
 * The check-in cells: what happened, who marked it and, for Late, how late (#257); empty without
 * a check-in.
 */
function checkInCells(text: ExportText, mark: Mark | null): ExportCell[] {
  return [
    checkInCell(text, mark?.actual),
    mark?.markedByName ?? "",
    mark?.lateMinutes ?? null,
  ];
}

/** Text that Excel tints like the app's tiles (CSV writes just the text). */
export type TintedCell = { text: string; tone: FillTone };

/** One export cell. CSV escaping happens later (`toCsv`); rows keep the text as typed. */
export type ExportCell = string | number | null | TintedCell;

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

/** The tinted answer cell; "No reply" only where an answer was awaited. */
function answerText(
  labels: AnswerLabels,
  text: ExportText,
  answer: Pick<
    NonNullable<PersonRow["answer"]>,
    "status" | "delayMinutes"
  > | null,
  awaited: boolean,
): TintedCell | "" {
  if (answer) {
    return {
      text: describeAnswer(labels, answer),
      tone: ANSWER_TONE[answer.status],
    };
  }
  return awaited ? { text: text.noReply, tone: ANSWER_TONE.no_reply } : "";
}

/** The fields `answerCells` reads, shared by meeting people and attendance details. */
type AnswerSource = Pick<
  PersonRow,
  "contactId" | "fullName" | "email" | "answer" | "emailStatus" | "mark"
>;

/**
 * The 13 `ANSWER_COLUMNS` cells for one person: Name, Email, Lists, Answer, Late by (min), Reason,
 * Comment, Answered at (meeting zone), After the deadline, Email, Checked in, Checked in by, Was
 * late by (min). Both the meeting export and the attendance details (and so the Google Sheet) use
 * it, so their columns can't drift apart.
 */
function answerCells(
  person: AnswerSource,
  listNames: Map<string, string[]>,
  labels: AnswerLabels,
  text: ExportText,
  timezone: string,
): ExportCell[] {
  return [
    person.fullName,
    person.email,
    (listNames.get(person.contactId) ?? []).join(", "),
    answerText(
      labels,
      text,
      person.answer,
      person.emailStatus === "sent" || person.emailStatus === "unknown",
    ),
    person.answer?.delayMinutes ?? null,
    person.answer?.reason ?? "",
    person.answer?.comment ?? "",
    person.answer ? at(person.answer.updatedAt, timezone) : "",
    person.answer?.afterDeadline ? text.yes : "",
    text.emailStatus(person.emailStatus),
    ...checkInCells(text, person.mark),
  ];
}

/** Meeting answers (`ANSWER_COLUMNS`): one row per invitee. */
export function meetingAnswerRows(
  people: PersonRow[],
  listNames: Map<string, string[]>,
  labels: AnswerLabels,
  text: ExportText,
  timezone: string,
): ExportCell[][] {
  return people.map((person) =>
    answerCells(person, listNames, labels, text, timezone),
  );
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
 * Attendance details and Google Sheet rows (`DETAIL_COLUMNS`): Meeting, Date (meeting zone), then
 * the 13 answer cells, one row per person per counted meeting. `meetingCell` replaces the plain
 * title (the sheet adds the date so repeated titles stay apart).
 */
export function attendanceDetailRows(
  details: AttendanceDetailRow[],
  listNames: Map<string, string[]>,
  labels: AnswerLabels,
  text: ExportText,
  options: { meetingCell?: (row: AttendanceDetailRow) => string } = {},
): ExportCell[][] {
  return details.map((row) => [
    options.meetingCell ? options.meetingCell(row) : row.title,
    at(row.startsAt, row.timezone),
    ...answerCells(row, listNames, labels, text, row.timezone),
  ]);
}

/**
 * Download my answers (`MEMBER_ANSWER_COLUMNS`, spec §7.4): the signed-in person's own invites,
 * newest first: Group, Meeting, Date, Answer, Late by, Reason, Comment, Answered at, After the
 * deadline, Checked in, Was late by. Every listed invite went out, so a missing answer is "No
 * reply" unless the meeting was an announcement.
 */
export function memberAnswerRows(
  rows: MyAnswer[],
  labels: AnswerLabels,
  text: ExportText,
): ExportCell[][] {
  return rows.map((row) => [
    row.workspaceName,
    row.title,
    at(row.startsAt, row.timezone),
    answerText(labels, text, row.answer, row.responseMode !== "announcement"),
    row.answer?.delayMinutes ?? null,
    row.answer?.reason ?? "",
    row.answer?.comment ?? "",
    row.answer ? at(row.answer.updatedAt, row.timezone) : "",
    row.answer?.afterDeadline ? text.yes : "",
    checkInCell(text, row.mark?.actual),
    row.mark?.lateMinutes ?? null,
  ]);
}
