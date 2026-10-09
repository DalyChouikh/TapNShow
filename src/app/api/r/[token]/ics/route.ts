import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { APP_NAME } from "@/config/app";
import {
  buildMeetingIcs,
  icsDescription,
  icsLocation,
} from "@/lib/calendar/ics";
import { slugBase } from "@/lib/slug";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { loadTokenContext } from "@/server/http/token-context";
import { lookupToken } from "@/server/queries/tokens";

/**
 * "Download calendar file" (spec §9 fallback): the meeting as a `PUBLISH` event to import. Read
 * only, like every GET on a personal link; the file never carries the link itself.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/r/[token]/ics">,
): Promise<Response> {
  const { token } = await ctx.params;
  const context = await loadTokenContext(request, token);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await lookupToken(context.client, context.tokenHash);
  if (error) {
    return fromDatabaseError(error);
  }
  const meeting = data?.meeting;
  if (!meeting?.startsAt || meeting.status !== "scheduled") {
    return apiError("not_found");
  }
  // One stable UID per person and meeting, so importing twice updates instead of duplicating.
  const uid = `${createHash("sha256").update(`ics-file:${context.tokenHash}`).digest("hex").slice(0, 32)}@${slugBase(APP_NAME)}`;
  const ics = buildMeetingIcs({
    method: "PUBLISH",
    uid,
    sequence: 0,
    stamp: new Date(),
    start: new Date(meeting.startsAt),
    durationMinutes: meeting.durationMinutes,
    title: meeting.title,
    description: icsDescription(meeting),
    location: icsLocation(meeting),
    url:
      meeting.locationMode !== "in_person" && meeting.meetingUrl
        ? meeting.meetingUrl
        : null,
  });
  return new NextResponse(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="${slugBase(meeting.title)}.ics"`,
      "cache-control": "private, no-store",
    },
  });
}
