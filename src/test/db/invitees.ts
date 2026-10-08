import { adminClient } from "./clients";

/**
 * Inserts an invitee with a known token hash (service role), as if its invite email went out.
 * Returns the invitee id and the hash to call the token functions with.
 */
export async function seedInvitee(
  workspaceId: string,
  meetingId: string,
  contactId: string,
  options: {
    emailStatus?: "queued" | "sent" | "skipped" | "failed" | "unknown";
  } = {},
): Promise<{ inviteeId: string; hash: string }> {
  const hash = crypto.randomUUID().replaceAll("-", "").repeat(2);
  const { data, error } = await adminClient()
    .from("meeting_invitees")
    .insert({
      workspace_id: workspaceId,
      meeting_id: meetingId,
      contact_id: contactId,
      token_hash: hash,
      email_status: options.emailStatus ?? "sent",
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  return { inviteeId: data.id, hash };
}
