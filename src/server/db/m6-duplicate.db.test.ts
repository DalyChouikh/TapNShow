import { beforeEach, describe, expect, it } from "vitest";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { seedInvitee } from "@/test/db/invitees";
import { seedMeeting } from "@/test/db/meetings";
import { overrideLimit } from "@/test/db/outbox";
import { seedContacts, seedList } from "@/test/db/roster";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

let owner: TestUser;
let workspace: TestWorkspace;
let meeting: string;
let list: string;
let contacts: string[];

const duplicate = (client = owner.client, id = meeting) =>
  client.rpc("duplicate_meeting", { p_meeting: id });

async function copyOf(id: string) {
  const { data } = await adminClient()
    .from("meetings")
    .select("*")
    .eq("id", id)
    .single();
  return data;
}

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  workspace = await createWorkspaceAs(owner, "Copy Club");
  contacts = await seedContacts(
    workspace.id,
    3,
    `dup-${crypto.randomUUID().slice(0, 6)}`,
  );
  list = await seedList(workspace.id, "Design");
  const start = new Date(Date.now() + 3 * 86_400_000).toISOString();
  meeting = await seedMeeting(workspace.id, {
    status: "scheduled",
    title: "Weekly sync",
    starts_at: start,
    response_deadline: new Date(Date.now() + 86_400_000).toISOString(),
    reminder_pending_hours: 24,
    reminder_going_hours: 2,
    location_mode: "hybrid",
    meeting_url: "https://meet.example.test/abc",
  });
  await adminClient()
    .from("meetings")
    .update({
      agenda_md: "- Recap",
      footer_note: "Bring a laptop",
      sent_at: new Date().toISOString(),
    })
    .eq("id", meeting);
  await adminClient()
    .from("meeting_audience")
    .insert({ workspace_id: workspace.id, meeting_id: meeting, list_id: list });
  await adminClient()
    .from("meeting_audience_people")
    .insert([
      {
        workspace_id: workspace.id,
        meeting_id: meeting,
        contact_id: contacts[0],
        mode: "include",
      },
      {
        workspace_id: workspace.id,
        meeting_id: meeting,
        contact_id: contacts[1],
        mode: "exclude",
      },
    ]);
  await seedInvitee(workspace.id, meeting, contacts[0]);
});

describe("duplicate_meeting", () => {
  it("makes a draft with the same details and settings, and no date", async () => {
    const { data: id, error } = await duplicate();
    expect(error).toBeNull();
    const [source, copy] = [await copyOf(meeting), await copyOf(id ?? "")];
    expect(copy).toMatchObject({
      status: "draft",
      title: "Weekly sync",
      agenda_md: "- Recap",
      duration_minutes: source?.duration_minutes,
      timezone: source?.timezone,
      location_mode: "hybrid",
      location_text: source?.location_text,
      meeting_url: "https://meet.example.test/abc",
      response_mode: source?.response_mode,
      delay_options: source?.delay_options,
      reason_required: source?.reason_required,
      comments_enabled: source?.comments_enabled,
      footer_note: "Bring a laptop",
      reminder_pending_hours: 24,
      reminder_going_hours: 2,
      starts_at: null,
      response_deadline: null,
      sent_at: null,
      ics_sequence: 0,
      created_by: owner.id,
    });
    expect(copy?.ics_uid).not.toBe(source?.ics_uid);
  });

  it("copies the audience but no invitees, answers or jobs", async () => {
    const { data: id } = await duplicate();
    const copy = id ?? "";
    const { data: lists } = await adminClient()
      .from("meeting_audience")
      .select("list_id")
      .eq("meeting_id", copy);
    expect(lists).toEqual([{ list_id: list }]);
    const { data: people } = await adminClient()
      .from("meeting_audience_people")
      .select("contact_id, mode")
      .eq("meeting_id", copy)
      .order("mode");
    // Enums sort in declaration order: include, then exclude.
    expect(people).toEqual([
      { contact_id: contacts[0], mode: "include" },
      { contact_id: contacts[1], mode: "exclude" },
    ]);
    for (const table of ["meeting_invitees", "responses"] as const) {
      const { count } = await adminClient()
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("meeting_id", copy);
      expect(count).toBe(0);
    }
    const { count: jobs } = await adminClient()
      .from("outbox_jobs")
      .select("id", { count: "exact", head: true })
      .eq("meeting_id", copy);
    expect(jobs).toBe(0);
  });

  it("refuses Viewers, other workspaces, and too many new meetings", async () => {
    const viewer = await createTestUser();
    await addMember(workspace.id, viewer.id, "viewer");
    await expectAppError(duplicate(viewer.client), "forbidden");
    const stranger = await createTestUser();
    await createWorkspaceAs(stranger, "Other Club");
    await expectAppError(duplicate(stranger.client), "not_found");
    const restore = overrideLimit("meetings_per_user_per_hour", 1);
    try {
      await duplicate();
      await expectAppError(duplicate(), "rate_limited");
    } finally {
      restore();
    }
  });

  it("copies a cancelled meeting too", async () => {
    await adminClient()
      .from("meetings")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", meeting);
    const { data: id, error } = await duplicate();
    expect(error).toBeNull();
    expect((await copyOf(id ?? ""))?.status).toBe("draft");
  });
});
