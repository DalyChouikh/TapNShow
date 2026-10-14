import { adminClient } from "./clients";
import { seedInvitee } from "./invitees";
import { seedMeeting } from "./meetings";

/** Inserts one contact with an exact email (service role). Returns its id. */
export async function seedContact(
  workspaceId: string,
  email: string,
  options: { fullName?: string; isAdhoc?: boolean } = {},
): Promise<string> {
  const { data, error } = await adminClient()
    .from("contacts")
    .insert({
      workspace_id: workspaceId,
      email,
      full_name: options.fullName ?? "Member",
      is_adhoc: options.isAdhoc ?? false,
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  return data.id;
}

/**
 * A scheduled meeting with one invitee for `contactId` (service role). `sent: false` leaves the
 * invite unsent (no token hash), like an invite still queued.
 */
export async function seedInviteFor(
  workspaceId: string,
  contactId: string,
  meeting: Parameters<typeof seedMeeting>[1] = {},
  options: { sent?: boolean } = {},
): Promise<{ meetingId: string; inviteeId: string }> {
  const meetingId = await seedMeeting(workspaceId, {
    status: "scheduled",
    ...meeting,
  });
  const { inviteeId } = await seedInvitee(workspaceId, meetingId, contactId);
  if (options.sent === false) {
    const { error } = await adminClient()
      .from("meeting_invitees")
      .update({ token_hash: null, email_status: "queued" })
      .eq("id", inviteeId);
    if (error) {
      throw error;
    }
  }
  return { meetingId, inviteeId };
}

/** Writes an answer and its history row directly (service role), as `submit_response` would. */
export async function seedAnswer(
  workspaceId: string,
  meetingId: string,
  inviteeId: string,
  answer: {
    status: "attending" | "late" | "absent" | "not_attending";
    delay_minutes?: number | null;
    reason?: string;
    comment?: string;
    needs_reconfirmation?: boolean;
  },
): Promise<string> {
  const admin = adminClient();
  const fields = {
    workspace_id: workspaceId,
    meeting_id: meetingId,
    invitee_id: inviteeId,
    status: answer.status,
    delay_minutes: answer.delay_minutes ?? null,
    reason: answer.reason ?? "",
    comment: answer.comment ?? "",
  };
  const { data, error } = await admin
    .from("responses")
    .insert({
      ...fields,
      needs_reconfirmation: answer.needs_reconfirmation ?? false,
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  const history = await admin
    .from("response_history")
    .insert({ ...fields, response_id: data.id, after_deadline: false });
  if (history.error) {
    throw history.error;
  }
  return data.id;
}
