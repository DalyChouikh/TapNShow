import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { addToList, seedMeeting } from "@/test/db/meetings";
import { queryLocalSql, runLocalSql } from "@/test/db/sql";
import { seedContacts, seedList } from "@/test/db/roster";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

const audienceSchema = z.object({
  list_ids: z.array(z.uuid()),
  people: z.array(
    z.object({
      id: z.uuid(),
      full_name: z.string(),
      email: z.string(),
      list_ids: z.array(z.uuid()),
      added: z.boolean(),
      excluded: z.boolean(),
      unsubscribed: z.boolean(),
      reported: z.boolean(),
      invited: z.boolean(),
    }),
  ),
  counts: z.object({
    selected: z.number(),
    invited: z.number(),
    unsubscribed: z.number(),
    to_invite: z.number(),
  }),
  max_invitees: z.number(),
});

let owner: TestUser;
let admin: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let workspace: TestWorkspace;

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  admin = await createTestUser({ fullName: "Admin" });
  viewer = await createTestUser({ fullName: "Viewer" });
  outsider = await createTestUser({ fullName: "Outsider" });
  workspace = await createWorkspaceAs(owner, "Meeting Club");
  await addMember(workspace.id, admin.id, "admin");
  await addMember(workspace.id, viewer.id, "viewer");
});

async function audience(meetingId: string, user: TestUser = admin) {
  const { data, error } = await user.client.rpc("meeting_audience", {
    p_meeting: meetingId,
  });
  if (error) {
    throw error;
  }
  return audienceSchema.parse(data);
}

describe("create_meeting", () => {
  it("creates a draft from the workspace defaults; Viewers and outsiders cannot", async () => {
    await adminClient()
      .from("workspaces")
      .update({
        default_response_mode: "rsvp",
        default_duration_minutes: 90,
        default_footer_note: "Laptops",
      })
      .eq("id", workspace.id);
    const created = await admin.client.rpc("create_meeting", {
      p_workspace: workspace.id,
    });
    expect(created.error).toBeNull();
    const row = await admin.client
      .from("meetings")
      .select(
        "status, response_mode, duration_minutes, timezone, footer_note, title, starts_at, created_by",
      )
      .eq("id", created.data ?? "")
      .single();
    expect(row.data).toEqual({
      status: "draft",
      response_mode: "rsvp",
      duration_minutes: 90,
      timezone: "Africa/Tunis",
      footer_note: "Laptops",
      title: "",
      starts_at: null,
      created_by: admin.id,
    });
    await expectAppError(
      viewer.client.rpc("create_meeting", { p_workspace: workspace.id }),
      "forbidden",
    );
    await expectAppError(
      outsider.client.rpc("create_meeting", { p_workspace: workspace.id }),
      "forbidden",
    );
  });
});

describe("meetings RLS", () => {
  it("edits and deletes drafts only, Owner/Admin only, within the column checks", async () => {
    const draft = await seedMeeting(workspace.id);
    const scheduled = await seedMeeting(workspace.id, { status: "scheduled" });
    const ok = await admin.client
      .from("meetings")
      .update({ title: "Kickoff" })
      .eq("id", draft)
      .select("title");
    expect(ok.data).toEqual([{ title: "Kickoff" }]);
    const locked = await admin.client
      .from("meetings")
      .update({ title: "Changed" })
      .eq("id", scheduled)
      .select("id");
    expect(locked.data).toEqual([]);
    const viewerEdit = await viewer.client
      .from("meetings")
      .update({ title: "V" })
      .eq("id", draft)
      .select("id");
    expect(viewerEdit.data).toEqual([]);
    const badUrl = await admin.client
      .from("meetings")
      .update({ meeting_url: "javascript:alert(1)" })
      .eq("id", draft);
    expect(badUrl.error?.code).toBe("23514");
    const badZone = await admin.client
      .from("meetings")
      .update({ timezone: "Mars/Olympus" })
      .eq("id", draft);
    expect(badZone.error?.message).toBe("tn:invalid_timezone");
    const statusWrite = await admin.client
      .from("meetings")
      .update({ status: "scheduled" })
      .eq("id", draft);
    expect(statusWrite.error?.code).toBe("42501");
    const outsiderRead = await outsider.client
      .from("meetings")
      .select("id")
      .eq("id", draft);
    expect(outsiderRead.data).toEqual([]);
    const deleteScheduled = await admin.client
      .from("meetings")
      .delete()
      .eq("id", scheduled)
      .select("id");
    expect(deleteScheduled.data).toEqual([]);
    const deleteDraft = await admin.client
      .from("meetings")
      .delete()
      .eq("id", draft)
      .select("id");
    expect(deleteDraft.data).toEqual([{ id: draft }]);
  });

  it("lets nobody but the service role write invitees", async () => {
    const meeting = await seedMeeting(workspace.id);
    const [contact] = await seedContacts(workspace.id, 1);
    const write = await admin.client.from("meeting_invitees").insert({
      workspace_id: workspace.id,
      meeting_id: meeting,
      contact_id: contact,
    });
    expect(write.error?.code).toBe("42501");
  });
});

describe("audience", () => {
  it("counts people once across lists, honors exclusions, additions and unsubscribes", async () => {
    const meeting = await seedMeeting(workspace.id);
    const [a, b, c, d, e] = await seedContacts(workspace.id, 5, "aud");
    const members = await seedList(workspace.id, "Members");
    const committee = await seedList(workspace.id, "Committee");
    await addToList(workspace.id, members, [a, b, c]);
    await addToList(workspace.id, committee, [c, d]);
    await adminClient()
      .from("contacts")
      .update({
        unsubscribed_at: new Date().toISOString(),
        unsubscribed_via: "link",
      })
      .eq("id", d);

    const set = await admin.client.rpc("set_meeting_audience", {
      p_meeting: meeting,
      p_list_ids: [members, committee],
      p_include: [e],
      p_exclude: [b],
    });
    expect(set.error).toBeNull();
    const result = await audience(meeting);
    expect(result.counts).toEqual({
      selected: 4,
      invited: 0,
      unsubscribed: 1,
      to_invite: 3,
    });
    expect(result.people.find((p) => p.id === c)?.list_ids.sort()).toEqual(
      [members, committee].sort(),
    );
    expect(result.people.find((p) => p.id === b)?.excluded).toBe(true);
    expect(result.people.find((p) => p.id === e)?.added).toBe(true);
    expect(result.people.find((p) => p.id === d)).toMatchObject({
      unsubscribed: true,
      reported: false,
    });

    await adminClient().from("meeting_invitees").insert({
      workspace_id: workspace.id,
      meeting_id: meeting,
      contact_id: a,
    });
    expect((await audience(meeting, viewer)).counts).toEqual({
      selected: 4,
      invited: 1,
      unsubscribed: 1,
      to_invite: 2,
    });
  });

  it("refuses foreign ids, overlapping sets, Viewers and cancelled meetings", async () => {
    const meeting = await seedMeeting(workspace.id);
    const [a] = await seedContacts(workspace.id, 1, "x");
    const other = await createWorkspaceAs(outsider, "Other");
    const [foreign] = await seedContacts(other.id, 1, "foreign");
    await expectAppError(
      admin.client.rpc("set_meeting_audience", {
        p_meeting: meeting,
        p_list_ids: [],
        p_include: [foreign],
        p_exclude: [],
      }),
      "not_found",
    );
    await expectAppError(
      admin.client.rpc("set_meeting_audience", {
        p_meeting: meeting,
        p_list_ids: [],
        p_include: [a],
        p_exclude: [a],
      }),
      "invalid_input",
    );
    await expectAppError(
      viewer.client.rpc("set_meeting_audience", {
        p_meeting: meeting,
        p_list_ids: [],
        p_include: [a],
        p_exclude: [],
      }),
      "forbidden",
    );
    const cancelled = await seedMeeting(workspace.id, { status: "cancelled" });
    await expectAppError(
      admin.client.rpc("set_meeting_audience", {
        p_meeting: cancelled,
        p_list_ids: [],
        p_include: [a],
        p_exclude: [],
      }),
      "meeting_not_draft",
    );
  });
});

describe("add_meeting_people", () => {
  it("adds several people at once as one-off guests or roster contacts, merging known emails", async () => {
    const meeting = await seedMeeting(workspace.id);
    const [known] = await seedContacts(workspace.id, 1, "known");
    const guests = await admin.client.rpc("add_meeting_people", {
      p_meeting: meeting,
      p_people: [
        { email: " Nour@Uni.tn ", full_name: "Nour  H." },
        { email: "known-1@example.test", full_name: "Renamed" },
      ],
      p_save_to_roster: false,
    });
    expect(guests.error).toBeNull();
    const nour = await adminClient()
      .from("contacts")
      .select("id, full_name, is_adhoc")
      .eq("workspace_id", workspace.id)
      .eq("email", "nour@uni.tn")
      .single();
    expect(nour.data).toMatchObject({ full_name: "Nour H.", is_adhoc: true });
    const knownRow = await adminClient()
      .from("contacts")
      .select("full_name, is_adhoc")
      .eq("id", known)
      .single();
    expect(knownRow.data).toEqual({ full_name: "known 1", is_adhoc: false });
    const roster = await admin.client.rpc("roster", {
      p_workspace: workspace.id,
    });
    expect(JSON.stringify(roster.data)).not.toContain("nour@uni.tn");
    expect((await audience(meeting)).counts.to_invite).toBe(2);

    await admin.client.rpc("add_meeting_people", {
      p_meeting: meeting,
      p_people: [{ email: "nour@uni.tn", full_name: "Nour H." }],
      p_save_to_roster: true,
    });
    const saved = await adminClient()
      .from("contacts")
      .select("is_adhoc")
      .eq("id", nour.data?.id ?? "")
      .single();
    expect(saved.data?.is_adhoc).toBe(false);
  });

  it("validates input and roles", async () => {
    const meeting = await seedMeeting(workspace.id);
    await expectAppError(
      admin.client.rpc("add_meeting_people", {
        p_meeting: meeting,
        p_people: [{ email: "nope", full_name: "X" }],
        p_save_to_roster: true,
      }),
      "invalid_input",
    );
    await expectAppError(
      admin.client.rpc("add_meeting_people", {
        p_meeting: meeting,
        p_people: [{ email: "a@b.co", full_name: "" }],
        p_save_to_roster: true,
      }),
      "invalid_input",
    );
    const tooMany = Array.from({ length: 51 }, (_, n) => ({
      email: `p${n}@b.co`,
      full_name: `P ${n}`,
    }));
    await expectAppError(
      admin.client.rpc("add_meeting_people", {
        p_meeting: meeting,
        p_people: tooMany,
        p_save_to_roster: true,
      }),
      "invalid_input",
    );
    await expectAppError(
      viewer.client.rpc("add_meeting_people", {
        p_meeting: meeting,
        p_people: [{ email: "a@b.co", full_name: "A" }],
        p_save_to_roster: true,
      }),
      "forbidden",
    );
  });
});

describe("writes go through the functions (security review)", () => {
  it("refuses direct meeting inserts, so the hourly limit cannot be skipped", async () => {
    const direct = await admin.client.from("meetings").insert({
      workspace_id: workspace.id,
      duration_minutes: 60,
      timezone: "Africa/Tunis",
      response_mode: "attendance",
      reason_required: true,
      comments_enabled: false,
      created_by: admin.id,
    });
    expect(direct.error?.code).toBe("42501");
  });

  it("refuses direct audience writes, so the per-meeting cap cannot be skipped", async () => {
    const meeting = await seedMeeting(workspace.id);
    const [a] = await seedContacts(workspace.id, 1, "direct");
    const list = await seedList(workspace.id, "Direct");
    const people = await admin.client.from("meeting_audience_people").insert({
      workspace_id: workspace.id,
      meeting_id: meeting,
      contact_id: a,
      mode: "include",
    });
    expect(people.error?.code).toBe("42501");
    const lists = await admin.client.from("meeting_audience").insert({
      workspace_id: workspace.id,
      meeting_id: meeting,
      list_id: list,
    });
    expect(lists.error?.code).toBe("42501");
  });

  it("counts a guest joining the roster against the contacts cap, on every path", async () => {
    const [{ value }] = queryLocalSql(
      "select value from private.app_limits where name = 'contacts_per_workspace_max'",
      z.array(z.object({ value: z.number() })).length(1),
    );
    const meeting = await seedMeeting(workspace.id);
    await admin.client.rpc("add_meeting_people", {
      p_meeting: meeting,
      p_people: [{ email: "guest-cap@uni.tn", full_name: "Guest" }],
      p_save_to_roster: false,
    });
    await seedContacts(workspace.id, 2, "cap-roster");
    runLocalSql(
      "update private.app_limits set value = 2 where name = 'contacts_per_workspace_max'",
    );
    try {
      const flip = await admin.client
        .from("contacts")
        .update({ is_adhoc: false })
        .eq("workspace_id", workspace.id)
        .eq("email", "guest-cap@uni.tn");
      expect(flip.error?.message).toBe("tn:contacts_limit_reached");
    } finally {
      runLocalSql(
        `update private.app_limits set value = ${value} where name = 'contacts_per_workspace_max'`,
      );
    }
  });
});

describe("one-off guests and the roster", () => {
  it("imports a one-off guest as new, moving them into the roster", async () => {
    const meeting = await seedMeeting(workspace.id);
    await admin.client.rpc("add_meeting_people", {
      p_meeting: meeting,
      p_people: [{ email: "guest@uni.tn", full_name: "Guest" }],
      p_save_to_roster: false,
    });
    const preview = await admin.client.rpc("import_contacts", {
      p_workspace: workspace.id,
      p_rows: [
        { row: 2, email: "guest@uni.tn", full_name: "Guest", lists: [] },
      ],
      p_dry_run: true,
    });
    expect(JSON.stringify(preview.data)).toContain('"new":1');
    await admin.client.rpc("import_contacts", {
      p_workspace: workspace.id,
      p_rows: [
        { row: 2, email: "guest@uni.tn", full_name: "Guest", lists: [] },
      ],
      p_dry_run: false,
    });
    const row = await adminClient()
      .from("contacts")
      .select("is_adhoc")
      .eq("workspace_id", workspace.id)
      .eq("email", "guest@uni.tn")
      .single();
    expect(row.data?.is_adhoc).toBe(false);
  });

  it("never turns a roster contact into a one-off guest", async () => {
    const [id] = await seedContacts(workspace.id, 1, "stay");
    const result = await admin.client
      .from("contacts")
      .update({ is_adhoc: true })
      .eq("id", id);
    expect(result.error?.message).toBe("tn:invalid_input");
  });
});
