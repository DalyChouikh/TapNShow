import { NextResponse, type NextRequest } from "next/server";
import { renderMeetingInviteEmail } from "@/emails/meeting-invite-email";
import { fromDatabaseError } from "@/server/http/errors";
import { loadMeetingContext } from "@/server/http/meeting-context";
import { getAudience } from "@/server/queries/meetings";
import { getWorkspaceSender } from "@/server/queries/sender";

/** Links in the preview go nowhere: it is rendered in a sandboxed frame and carries no token. */
const INERT = "#";

/**
 * The invite exactly as an example recipient would get it (spec §7.2 Review). Needs a start time;
 * before that the Review step shows its own "add a date" hint instead of calling this.
 */
export async function GET(
  _request: NextRequest | Request,
  ctx: RouteContext<"/api/workspaces/[slug]/meetings/[id]/preview">,
): Promise<NextResponse> {
  const { slug, id } = await ctx.params;
  const context = await loadMeetingContext(slug, id);
  if (!context.ok) {
    return context.response;
  }
  const [audience, sender] = await Promise.all([
    getAudience(context.supabase, id),
    getWorkspaceSender(context.supabase, context.workspace.id),
  ]);
  if (audience.error || sender.error) {
    return fromDatabaseError(
      (audience.error ?? sender.error) as { message: string },
    );
  }
  const example =
    audience.data?.people.find(
      (p) => !p.excluded && !p.unsubscribed && !p.invited,
    )?.fullName ?? context.workspace.name;
  const meeting = context.meeting;
  const email = await renderMeetingInviteEmail({
    workspaceName: context.workspace.name,
    recipientName: example,
    senderEmail: sender.data?.sender?.email ?? "",
    meeting: {
      title: meeting.title,
      agendaMd: meeting.agendaMd,
      startsAt: meeting.startsAt ?? new Date().toISOString(),
      durationMinutes: meeting.durationMinutes,
      timezone: meeting.timezone,
      locationMode: meeting.locationMode,
      locationText: meeting.locationText,
      meetingUrl: meeting.meetingUrl,
      responseMode: meeting.responseMode,
      responseDeadline: meeting.responseDeadline,
    },
    links: { respond: INERT, unsubscribe: INERT, report: INERT },
  });
  return NextResponse.json({
    subject: email.subject,
    html: email.html,
    fromName: context.workspace.name,
    fromEmail: sender.data?.sender?.email ?? null,
    recipientName: example,
  });
}
