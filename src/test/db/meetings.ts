import { adminClient } from "./clients";

/** Inserts a meeting directly (service role). Defaults: a draft tomorrow at 18:00 UTC, attendance mode. */
export async function seedMeeting(
  workspaceId: string,
  overrides: Partial<{
    title: string;
    status: "draft" | "scheduled" | "cancelled";
    starts_at: string | null;
    location_mode: "in_person" | "online" | "hybrid";
    location_text: string;
    meeting_url: string;
    created_by: string;
    response_mode: "announcement" | "rsvp" | "attendance";
    response_deadline: string | null;
    reminder_pending_hours: number | null;
    reminder_going_hours: number | null;
  }> = {},
): Promise<string> {
  const tomorrow = new Date(Date.now() + 24 * 3600_000);
  tomorrow.setUTCHours(18, 0, 0, 0);
  const { data, error } = await adminClient()
    .from("meetings")
    .insert({
      workspace_id: workspaceId,
      title: "Weekly sync",
      starts_at: tomorrow.toISOString(),
      duration_minutes: 60,
      timezone: "Africa/Tunis",
      location_mode: "in_person",
      location_text: "Room B12",
      response_mode: "attendance",
      delay_options: [5, 10, 15, 30],
      reason_required: true,
      comments_enabled: false,
      ...overrides,
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  return data.id;
}

/** Puts contacts in a list (service role). */
export async function addToList(
  workspaceId: string,
  listId: string,
  contactIds: string[],
): Promise<void> {
  const { error } = await adminClient()
    .from("list_contacts")
    .insert(
      contactIds.map((contactId) => ({
        workspace_id: workspaceId,
        list_id: listId,
        contact_id: contactId,
      })),
    );
  if (error) {
    throw error;
  }
}
