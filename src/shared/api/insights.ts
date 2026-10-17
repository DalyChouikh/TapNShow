import { z } from "zod";
import { INSIGHTS_CHART_MEETINGS, OFTEN_MISSING_PEOPLE } from "@/config/home";

const count = z.number().int().nonnegative();

/** One counted meeting in Home's chart, counted like Lists → Attendance (check-in wins). */
export const insightsMeetingSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  /** The meeting's own zone: its date label is in it. */
  timezone: z.string(),
  attending: count,
  late: count,
  absent: count,
  noReply: count,
});
/** A chart bar. */
export type InsightsMeeting = z.infer<typeof insightsMeetingSchema>;

/** A roster member who missed meetings in the period (missed = absent + no reply). */
export const missingMemberSchema = z.object({
  contactId: z.uuid(),
  fullName: z.string(),
  invited: count,
  missed: count,
  absent: count,
  noReply: count,
});
/** An "Often missing" row. */
export type MissingMember = z.infer<typeof missingMemberSchema>;

/** `GET …/insights?from=&to=`: what Home shows about the workspace (workspace Home design §3.1). */
export const workspaceInsightsSchema = z.object({
  /** Roster members (not ad hoc), lists, and Admins and Viewers plus pending invites. */
  roster: z.object({ members: count, lists: count, committee: count }),
  /** Counted meetings ever, whatever the period (0: none has happened yet). */
  held: count,
  period: z.object({
    /** Counted meetings in the period. */
    meetings: count,
    /** Mean of Going + Late per counted meeting, and the mean invited. */
    cameAverage: z.number().nonnegative(),
    invitedAverage: z.number().nonnegative(),
    /** Share of reachable invitees whose first answer came before the start; null with none. */
    answeredBeforeStart: z.number().min(0).max(1).nullable(),
  }),
  /** The newest counted meetings of the period, oldest first. */
  chart: z.array(insightsMeetingSchema).max(INSIGHTS_CHART_MEETINGS),
  oftenMissing: z.array(missingMemberSchema).max(OFTEN_MISSING_PEOPLE),
});
/** Home's insights. */
export type WorkspaceInsights = z.infer<typeof workspaceInsightsSchema>;
