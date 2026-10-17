import { createHash, randomBytes } from "node:crypto";
import { adminClient, workspaceIdOf } from "./admin";

/** Adds a named member with `role` to the workspace at `slug` (service role; test setup only). */
export async function seedMember(
  slug: string,
  role: "admin" | "viewer",
  displayName: string,
  canCheckIn = false,
): Promise<{ id: string; email: string }> {
  const client = adminClient();
  const email = `seed-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const created = await client.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (created.error) {
    throw created.error;
  }
  const id = created.data.user.id;
  const workspaceId = await workspaceIdOf(slug);
  const profile = await client
    .from("profiles")
    .update({ display_name: displayName })
    .eq("user_id", id);
  const member = await client.from("workspace_roles").insert({
    workspace_id: workspaceId,
    user_id: id,
    role,
    can_check_in: canCheckIn,
  });
  if (profile.error || member.error) {
    throw profile.error ?? member.error;
  }
  return { id, email };
}

/** Puts people and their lists straight into a workspace's roster (service role; test setup only). */
export async function seedRoster(
  slug: string,
  people: Array<{ fullName: string; email: string; lists?: string[] }>,
): Promise<void> {
  const client = adminClient();
  const workspaceId = await workspaceIdOf(slug);
  const names = [...new Set(people.flatMap((person) => person.lists ?? []))];
  const lists = names.length
    ? await client
        .from("lists")
        .insert(names.map((name) => ({ workspace_id: workspaceId, name })))
        .select("id, name")
    : { data: [], error: null };
  const contacts = await client
    .from("contacts")
    .insert(
      people.map((person) => ({
        workspace_id: workspaceId,
        email: person.email,
        full_name: person.fullName,
      })),
    )
    .select("id, email");
  if (lists.error || contacts.error) {
    throw lists.error ?? contacts.error;
  }
  const listId = new Map(lists.data.map((list) => [list.name, list.id]));
  const contactId = new Map(
    contacts.data.map((contact) => [contact.email, contact.id]),
  );
  const links = people.flatMap((person) =>
    (person.lists ?? []).map((name) => ({
      workspace_id: workspaceId,
      list_id: listId.get(name) ?? "",
      contact_id: contactId.get(person.email) ?? "",
    })),
  );
  if (links.length) {
    const linked = await client.from("list_contacts").insert(links);
    if (linked.error) {
      throw linked.error;
    }
  }
}

/**
 * One contact invited to a meeting of the workspace at `slug`, answered through the real answer
 * function while the meeting was upcoming, then moved two days into the past (service role; test
 * setup only). Returns the contact's name.
 */
export async function seedPastMeetingWithAnswer(
  slug: string,
  stamp: string,
  answer: { status: "late"; delayMinutes: number; reason: string },
): Promise<string> {
  const client = adminClient();
  const workspaceId = await workspaceIdOf(slug);
  const fullName = `Lina ${stamp}`;
  const contact = await client
    .from("contacts")
    .insert({
      workspace_id: workspaceId,
      email: `lina-${stamp}@example.test`,
      full_name: fullName,
    })
    .select("id")
    .single();
  const meeting = await client
    .from("meetings")
    .insert({
      workspace_id: workspaceId,
      title: `Past sync ${stamp}`,
      starts_at: new Date(Date.now() + 86_400_000).toISOString(),
      duration_minutes: 60,
      timezone: "Africa/Tunis",
      location_mode: "in_person",
      location_text: "Room 1",
      response_mode: "attendance",
      delay_options: [5, 10, 15],
      reason_required: true,
      comments_enabled: false,
      status: "scheduled",
    })
    .select("id")
    .single();
  if (contact.error || meeting.error) {
    throw contact.error ?? meeting.error;
  }
  const tokenHash = createHash("sha256")
    .update(crypto.randomUUID())
    .digest("hex");
  const invitee = await client.from("meeting_invitees").insert({
    workspace_id: workspaceId,
    meeting_id: meeting.data.id,
    contact_id: contact.data.id,
    token_hash: tokenHash,
    email_status: "sent",
  });
  if (invitee.error) {
    throw invitee.error;
  }
  const answered = await client.rpc("token_submit_response", {
    p_token_hash: tokenHash,
    p_status: answer.status,
    p_delay_minutes: answer.delayMinutes,
    p_reason: answer.reason,
    p_comment: null,
  });
  const moved = await client
    .from("meetings")
    .update({
      starts_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    })
    .eq("id", meeting.data.id);
  if (answered.error || moved.error) {
    throw answered.error ?? moved.error;
  }
  return fullName;
}

/** One person's answer to a seeded past meeting; null leaves it unanswered. */
export type PastAnswer = "attending" | "late" | "absent" | null;

/**
 * Weekly past meetings of the workspace at `slug` (the newest a week ago), each inviting every
 * contact named in `people` (already in the roster) with `answers[meeting][person]`, answered
 * through the real answer function while upcoming, then moved into the past (service role; test
 * setup only). Returns the meeting ids, oldest first.
 */
export async function seedPastMeetings(
  slug: string,
  stamp: string,
  people: string[],
  answers: PastAnswer[][],
): Promise<string[]> {
  const client = adminClient();
  const workspaceId = await workspaceIdOf(slug);
  const contacts = await client
    .from("contacts")
    .select("id, full_name")
    .eq("workspace_id", workspaceId)
    .in("full_name", people);
  if (contacts.error) {
    throw contacts.error;
  }
  const idOf = new Map(contacts.data.map((row) => [row.full_name, row.id]));
  const ids: string[] = [];
  for (const [index, row] of answers.entries()) {
    const meeting = await client
      .from("meetings")
      .insert({
        workspace_id: workspaceId,
        title: `Weekly sync ${index + 1} ${stamp}`,
        starts_at: new Date(Date.now() + 86_400_000).toISOString(),
        duration_minutes: 60,
        timezone: "Africa/Tunis",
        location_mode: "in_person",
        location_text: "Room 1",
        response_mode: "attendance",
        delay_options: [5, 10, 15],
        reason_required: true,
        comments_enabled: false,
        status: "scheduled",
      })
      .select("id")
      .single();
    if (meeting.error) {
      throw meeting.error;
    }
    for (const [person, status] of row.entries()) {
      const tokenHash = createHash("sha256")
        .update(crypto.randomUUID())
        .digest("hex");
      const invitee = await client.from("meeting_invitees").insert({
        workspace_id: workspaceId,
        meeting_id: meeting.data.id,
        contact_id: idOf.get(people[person]) ?? "",
        token_hash: tokenHash,
        email_status: "sent",
      });
      if (invitee.error) {
        throw invitee.error;
      }
      if (status) {
        const answered = await client.rpc("token_submit_response", {
          p_token_hash: tokenHash,
          p_status: status,
          p_delay_minutes: status === "late" ? 10 : null,
          p_reason: status === "attending" ? null : "Exam the next morning",
          p_comment: null,
        });
        if (answered.error) {
          throw answered.error;
        }
      }
    }
    const startsAt = Date.now() - (answers.length - index) * 7 * 86_400_000;
    const moved = await client
      .from("meetings")
      .update({ starts_at: new Date(startsAt).toISOString() })
      .eq("id", meeting.data.id);
    // The answers came while it was upcoming: a day before its (new) start.
    const dated = await client
      .from("responses")
      .update({ responded_at: new Date(startsAt - 86_400_000).toISOString() })
      .eq("meeting_id", meeting.data.id);
    if (moved.error || dated.error) {
      throw moved.error ?? dated.error;
    }
    ids.push(meeting.data.id);
  }
  return ids;
}

/**
 * A meeting that started an hour ago with two invited people: `going` answered Going, `silent`
 * did not answer (service role; test setup only). Returns the meeting id.
 */
export async function seedStartedMeeting(
  slug: string,
  stamp: string,
  names: { going: string; silent: string },
): Promise<string> {
  const client = adminClient();
  const workspaceId = await workspaceIdOf(slug);
  const meeting = await client
    .from("meetings")
    .insert({
      workspace_id: workspaceId,
      title: `Door sync ${stamp}`,
      starts_at: new Date(Date.now() + 86_400_000).toISOString(),
      duration_minutes: 60,
      timezone: "Africa/Tunis",
      location_mode: "in_person",
      location_text: "Room 1",
      response_mode: "attendance",
      delay_options: [5, 10, 15],
      reason_required: true,
      comments_enabled: false,
      status: "scheduled",
    })
    .select("id")
    .single();
  if (meeting.error) {
    throw meeting.error;
  }
  for (const [index, fullName] of [names.going, names.silent].entries()) {
    const contact = await client
      .from("contacts")
      .insert({
        workspace_id: workspaceId,
        email: `door-${index}-${stamp}@example.test`,
        full_name: fullName,
      })
      .select("id")
      .single();
    if (contact.error) {
      throw contact.error;
    }
    const tokenHash = createHash("sha256")
      .update(crypto.randomUUID())
      .digest("hex");
    const invitee = await client.from("meeting_invitees").insert({
      workspace_id: workspaceId,
      meeting_id: meeting.data.id,
      contact_id: contact.data.id,
      token_hash: tokenHash,
      email_status: "sent",
    });
    if (invitee.error) {
      throw invitee.error;
    }
    if (index === 0) {
      const answered = await client.rpc("token_submit_response", {
        p_token_hash: tokenHash,
        p_status: "attending",
        p_delay_minutes: null,
        p_reason: null,
        p_comment: null,
      } as never);
      if (answered.error) {
        throw answered.error;
      }
    }
  }
  const moved = await client
    .from("meetings")
    .update({ starts_at: new Date(Date.now() - 3600_000).toISOString() })
    .eq("id", meeting.data.id);
  if (moved.error) {
    throw moved.error;
  }
  return meeting.data.id;
}

/** Makes a meeting's "not answered" reminder timer due now, as if its time came (service role). */
export async function dueTimers(meetingId: string): Promise<void> {
  const { error } = await adminClient()
    .from("outbox_jobs")
    .update({ run_after: new Date(Date.now() - 1000).toISOString() })
    .eq("meeting_id", meetingId)
    .eq("kind", "reminder")
    .is("invitee_id", null)
    .eq("payload->>audience", "pending");
  if (error) {
    throw error;
  }
}

/**
 * `count` people invited to a scheduled meeting of the workspace at `slug`, as if their invites
 * went out (service role; test setup only). Returns each one's answer-link token (the app keeps
 * only its SHA-256, like `inviteeTokenHash`).
 */
export async function seedInvitedPeople(
  slug: string,
  stamp: string,
  count: number,
): Promise<string[]> {
  const client = adminClient();
  const workspaceId = await workspaceIdOf(slug);
  const meeting = await client
    .from("meetings")
    .insert({
      workspace_id: workspaceId,
      title: `Invited sync ${stamp}`,
      starts_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      duration_minutes: 60,
      timezone: "Africa/Tunis",
      location_mode: "in_person",
      location_text: "Room 1",
      response_mode: "attendance",
      delay_options: [5, 10, 15],
      reason_required: true,
      comments_enabled: false,
      status: "scheduled",
    })
    .select("id")
    .single();
  if (meeting.error) {
    throw meeting.error;
  }
  const tokens: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const contact = await client
      .from("contacts")
      .insert({
        workspace_id: workspaceId,
        email: `invited-${index}-${stamp}@example.test`,
        full_name: `Invited ${index} ${stamp}`,
      })
      .select("id")
      .single();
    if (contact.error) {
      throw contact.error;
    }
    const token = randomBytes(32).toString("base64url");
    const invitee = await client.from("meeting_invitees").insert({
      workspace_id: workspaceId,
      meeting_id: meeting.data.id,
      contact_id: contact.data.id,
      token_hash: createHash("sha256").update(token).digest("hex"),
      email_status: "sent",
    });
    if (invitee.error) {
      throw invitee.error;
    }
    tokens.push(token);
  }
  return tokens;
}
