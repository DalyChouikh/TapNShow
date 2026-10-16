import { TZDate } from "@date-fns/tz";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { adminClient, createTestUser, type TestUser } from "@/test/db/clients";
import { seedInvitee } from "@/test/db/invitees";
import { addToList, seedMeeting } from "@/test/db/meetings";
import { parkAllJobs } from "@/test/db/outbox";
import { parkAllPlatformEvents } from "@/test/db/platform";
import { explainCall, planUsesIndex } from "@/test/db/plans";
import { seedContacts, seedList } from "@/test/db/roster";
import { seedConnection } from "@/test/db/sender";
import {
  dirtyYears,
  makeDue,
  parkAllSheets,
  seedSheet,
  unparkSheet,
} from "@/test/db/sheets";
import { queryLocalSql, runLocalSql } from "@/test/db/sql";
import { createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

const DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";
const ZONE = "Africa/Tunis";
/** The year tab of an instant in the test workspaces' zone (twin rule: private.sheet_year). */
const yearOf = (iso: string) => new TZDate(iso, ZONE).getFullYear();

type Person = { inviteeId: string; hash: string; contactId: string };

let owner: TestUser;
let workspace: TestWorkspace;
let meeting: string;
let meetingYear: number;
let a: Person;
let b: Person;

async function person(
  workspaceId: string,
  meetingId: string,
  name: string,
  emailStatus: "sent" | "queued" = "sent",
): Promise<Person> {
  const { data, error } = await adminClient()
    .from("contacts")
    .insert({
      workspace_id: workspaceId,
      full_name: name,
      email: `${crypto.randomUUID().slice(0, 8)}@example.test`,
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  const seeded = await seedInvitee(workspaceId, meetingId, data.id, {
    emailStatus,
  });
  return { ...seeded, contactId: data.id };
}

async function answer(who: Person, status: "attending" | "absent") {
  const { error } = await adminClient().rpc("token_submit_response", {
    p_token_hash: who.hash,
    p_status: status,
    p_delay_minutes: null,
    p_reason: status === "absent" ? "Exam" : null,
    p_comment: null,
  } as never);
  if (error) {
    throw error;
  }
}

const clearMarks = (workspaceId = workspace.id) =>
  runLocalSql(
    `delete from public.sheet_dirty_years where workspace_id = '${workspaceId}'`,
  );
const years = async (workspaceId = workspace.id) =>
  (await dirtyYears(workspaceId)).map((row) => row.year);
const claimSchema = z.array(
  z.object({
    workspace_id: z.uuid(),
    spreadsheet_id: z.string().nullable(),
    connection: z.object({ id: z.uuid(), google_sub: z.string() }).nullable(),
    years: z.array(z.object({ year: z.number(), version: z.number() })),
    tabs: z.array(z.object({ tab_key: z.string() })),
  }),
);
async function claim(run = crypto.randomUUID()) {
  const { data, error } = await adminClient().rpc("sheet_claim", {
    p_run: run,
    p_limit: 5,
    p_lease_seconds: 120,
  });
  if (error) {
    throw error;
  }
  return { run, sheets: claimSchema.parse(data) };
}

const workersDue = () =>
  queryLocalSql(
    "select private.workers_due() as due",
    z.array(z.object({ due: z.boolean() })).length(1),
  )[0].due;

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Worker Owner" });
  workspace = await createWorkspaceAs(owner, "Worker Club");
  const connection = await seedConnection(owner.id, { scopes: [DRIVE_FILE] });
  await seedSheet(workspace.id, connection.id, {
    googleSub: connection.sub,
    spreadsheetId: "file-abcdefghij",
  });
  meeting = await seedMeeting(workspace.id, { status: "scheduled" });
  const { data } = await adminClient()
    .from("meetings")
    .select("starts_at")
    .eq("id", meeting)
    .single();
  meetingYear = yearOf(data?.starts_at ?? "");
  a = await person(workspace.id, meeting, "Amira");
  b = await person(workspace.id, meeting, "Badr");
  clearMarks();
});

describe("change marks (statement-level triggers)", () => {
  it("an answer marks its meeting's year, and a second one raises the version", async () => {
    await answer(a, "attending");
    expect(await dirtyYears(workspace.id)).toEqual([
      { year: meetingYear, version: 1 },
    ]);
    await answer(b, "absent");
    expect(await dirtyYears(workspace.id)).toEqual([
      { year: meetingYear, version: 2 },
    ]);
  });

  it("a check-in marks the year", async () => {
    const startsAt = new Date(Date.now() - 3_600_000).toISOString();
    await adminClient()
      .from("meetings")
      .update({ starts_at: startsAt })
      .eq("id", meeting);
    clearMarks();
    const { error } = await owner.client.rpc("mark_attendance", {
      p_meeting: meeting,
      p_invitee: a.inviteeId,
      p_actual: "present",
    } as never);
    expect(error).toBeNull();
    expect(await years()).toEqual([yearOf(startsAt)]);
  });

  it("renaming the person who checked someone in marks that year; renaming anyone else does not (#291)", async () => {
    const startsAt = new Date(Date.now() - 3_600_000).toISOString();
    await adminClient()
      .from("meetings")
      .update({ starts_at: startsAt })
      .eq("id", meeting);
    await owner.client.rpc("mark_attendance", {
      p_meeting: meeting,
      p_invitee: a.inviteeId,
      p_actual: "present",
    } as never);
    clearMarks();
    const bystander = await createTestUser({ fullName: "Bystander" });
    await adminClient()
      .from("profiles")
      .update({ display_name: "Someone Else" })
      .eq("user_id", bystander.id);
    expect(await years()).toEqual([]);
    await adminClient()
      .from("profiles")
      .update({ display_name: "Worker Owner Renamed" })
      .eq("user_id", owner.id);
    expect(await years()).toEqual([yearOf(startsAt)]);
  });

  it("one statement over 1,000 invitees costs one mark at workspace size (2,000 contacts)", async () => {
    // 2,000 with Amira and Badr: the workspace cap.
    const contacts = await seedContacts(workspace.id, 1998, "bulk");
    const big = await seedMeeting(workspace.id, { status: "scheduled" });
    clearMarks();
    const started = performance.now();
    const { error } = await adminClient()
      .from("meeting_invitees")
      .insert(
        contacts.slice(0, 1000).map((contact) => ({
          workspace_id: workspace.id,
          meeting_id: big,
          contact_id: contact,
          email_status: "queued" as const,
        })),
      );
    expect(error).toBeNull();
    await adminClient()
      .from("meeting_invitees")
      .update({ email_status: "sent" })
      .eq("meeting_id", big);
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(await dirtyYears(workspace.id)).toEqual([
      { year: meetingYear, version: 2 },
    ]);
  }, 60_000);

  it("renaming an invited contact marks; renaming one never invited does not", async () => {
    await adminClient()
      .from("contacts")
      .update({ full_name: "Amira B." })
      .eq("id", a.contactId);
    expect(await years()).toEqual([meetingYear]);
    clearMarks();
    const [stranger] = await seedContacts(workspace.id, 1, "stranger");
    await adminClient()
      .from("contacts")
      .update({ full_name: "Someone" })
      .eq("id", stranger);
    expect(await years()).toEqual([]);
  });

  it("a list rename marks every year with a tab, plus the current year", async () => {
    const list = await seedList(workspace.id, "Committee");
    await adminClient().from("sheet_tabs").insert({
      workspace_id: workspace.id,
      tab_key: "2025",
      year: 2025,
      google_sheet_id: 11,
      title: "2025",
      content_hash: "h",
      row_count: 0,
      format_version: 1,
    });
    clearMarks();
    await adminClient().from("lists").update({ name: "Board" }).eq("id", list);
    expect(await years()).toEqual(
      [...new Set([yearOf(new Date().toISOString()), 2025])].sort(
        (x, y) => y - x,
      ),
    );
  });

  it("adding an invited contact to a list marks the year", async () => {
    const list = await seedList(workspace.id, "Design");
    clearMarks();
    await addToList(workspace.id, list, [a.contactId]);
    expect(await years()).toEqual([meetingYear]);
  });

  it("moving a meeting across New Year marks both years", async () => {
    await adminClient()
      .from("meetings")
      .update({ starts_at: "2026-12-31T12:00:00Z" })
      .eq("id", meeting);
    clearMarks();
    await adminClient()
      .from("meetings")
      .update({ starts_at: "2027-01-02T12:00:00Z" })
      .eq("id", meeting);
    expect(await years()).toEqual([2027, 2026]);
  });

  it("editing a draft marks nothing", async () => {
    const draft = await seedMeeting(workspace.id, { status: "draft" });
    clearMarks();
    await adminClient()
      .from("meetings")
      .update({ title: "Still a draft" })
      .eq("id", draft);
    expect(await years()).toEqual([]);
  });

  it("deleting a meeting marks its year", async () => {
    await adminClient().from("meetings").delete().eq("id", meeting);
    expect(await years()).toEqual([meetingYear]);
  });

  it("deleting a workspace that has a sheet succeeds", async () => {
    const { error } = await owner.client.rpc("delete_workspace", {
      p_workspace: workspace.id,
      p_confirm_name: "Worker Club",
    });
    expect(error).toBeNull();
  });
});

describe("a workspace without a sheet", () => {
  it("answers, imports and edits write no marks", async () => {
    const other = await createWorkspaceAs(owner, "No Sheet Club");
    const otherMeeting = await seedMeeting(other.id, { status: "scheduled" });
    const someone = await person(other.id, otherMeeting, "Chams");
    await answer(someone, "attending");
    await seedContacts(other.id, 50, "imported");
    await adminClient()
      .from("meetings")
      .update({ title: "Renamed" })
      .eq("id", otherMeeting);
    expect(
      queryLocalSql(
        `select count(*)::int as n from public.sheet_dirty_years where workspace_id = '${other.id}'`,
        z.array(z.object({ n: z.number() })),
      )[0].n,
    ).toBe(0);
  });
});

describe("sheet_claim", () => {
  beforeEach(() => {
    parkAllSheets();
    unparkSheet(workspace.id);
  });

  it("waits a quiet minute, then claims once with years and the account", async () => {
    await answer(a, "attending");
    expect((await claim()).sheets).toEqual([]);
    makeDue(workspace.id);
    const first = await claim();
    expect(first.sheets).toHaveLength(1);
    expect(first.sheets[0]).toMatchObject({
      workspace_id: workspace.id,
      spreadsheet_id: "file-abcdefghij",
      years: [{ year: meetingYear, version: 1 }],
    });
    expect(first.sheets[0].connection).not.toBeNull();
    expect((await claim()).sheets).toEqual([]);
  });

  it("claims a sheet that keeps changing once its first change is 5 minutes old", async () => {
    await answer(a, "attending");
    runLocalSql(
      `update public.sheet_dirty_years set first_changed_at = now() - interval '6 minutes', changed_at = now() where workspace_id = '${workspace.id}'`,
    );
    expect((await claim()).sheets.map((sheet) => sheet.workspace_id)).toEqual([
      workspace.id,
    ]);
  });

  it("claims a new sheet without a file at once", async () => {
    const fresh = await createWorkspaceAs(owner, "Fresh Club");
    const connection = await seedConnection(owner.id, { scopes: [DRIVE_FILE] });
    await seedSheet(fresh.id, connection.id, { googleSub: connection.sub });
    expect((await claim()).sheets.map((sheet) => sheet.workspace_id)).toEqual([
      fresh.id,
    ]);
  });

  it("never claims a paused sheet or one waiting to retry", async () => {
    await answer(a, "attending");
    makeDue(workspace.id);
    runLocalSql(
      `update public.sheet_syncs set retry_at = now() + interval '5 minutes' where workspace_id = '${workspace.id}'`,
    );
    expect((await claim()).sheets).toEqual([]);
    runLocalSql(
      `update public.sheet_syncs set retry_at = now(), status = 'paused', paused_reason = 'trashed' where workspace_id = '${workspace.id}'`,
    );
    expect((await claim()).sheets).toEqual([]);
  });
});

describe("sheet_finish_year", () => {
  beforeEach(() => {
    parkAllSheets();
    unparkSheet(workspace.id);
  });

  it("keeps a year that changed during the write, and clears it at the version read", async () => {
    await answer(a, "attending");
    makeDue(workspace.id);
    const { run } = await claim();
    await answer(b, "absent");
    const finish = (version: number, runId = run) =>
      adminClient().rpc("sheet_finish_year", {
        p_workspace: workspace.id,
        p_run: runId,
        p_year: meetingYear,
        p_version: version,
      });
    expect((await finish(1)).data).toBe(false);
    expect(await years()).toEqual([meetingYear]);
    expect((await finish(2, crypto.randomUUID())).data).toBe(false);
    expect((await finish(2)).data).toBe(true);
    expect(await years()).toEqual([]);
  });
});

describe("sheet_retry", () => {
  it("backs off 1, 2, 4… minutes with jitter, never past 30, and frees the lease", async () => {
    const run = crypto.randomUUID();
    const waits: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      runLocalSql(
        `update public.sheet_syncs set run_id = '${run}', locked_until = now() + interval '1 minute' where workspace_id = '${workspace.id}'`,
      );
      const { error } = await adminClient().rpc("sheet_retry", {
        p_workspace: workspace.id,
        p_run: run,
        p_error: "HTTP 429",
      });
      expect(error).toBeNull();
      const [row] = queryLocalSql(
        `select extract(epoch from (retry_at - now()))::float as wait, run_id is null as freed from public.sheet_syncs where workspace_id = '${workspace.id}'`,
        z.array(z.object({ wait: z.number(), freed: z.boolean() })).length(1),
      );
      expect(row.freed).toBe(true);
      waits.push(row.wait);
    }
    [1, 2, 4, 8, 16, 30, 30].forEach((minutes, index) => {
      expect(waits[index]).toBeGreaterThanOrEqual(minutes * 60 - 1);
      expect(waits[index]).toBeLessThanOrEqual(minutes * 60 + 31);
    });
  });
});

describe("sheet_pause", () => {
  it("pauses with the reason and tells the Owner once a day", async () => {
    const run = crypto.randomUUID();
    const lease = () =>
      runLocalSql(
        `update public.sheet_syncs set status = 'active', paused_reason = null, run_id = '${run}' where workspace_id = '${workspace.id}'`,
      );
    const pause = () =>
      adminClient().rpc("sheet_pause", {
        p_workspace: workspace.id,
        p_run: run,
        p_reason: "trashed",
      });
    lease();
    expect((await pause()).data).toEqual({
      email: owner.email,
      workspace_name: "Worker Club",
      workspace_slug: workspace.slug,
      reason: "trashed",
    });
    const { data } = await adminClient()
      .from("sheet_syncs")
      .select("status, paused_reason")
      .eq("workspace_id", workspace.id)
      .single();
    expect(data).toEqual({ status: "paused", paused_reason: "trashed" });
    lease();
    expect((await pause()).data).toBeNull();
  });
});

describe("sheet_rows", () => {
  const rowSchema = z.array(
    z.object({
      meeting_id: z.uuid(),
      title: z.string(),
      full_name: z.string(),
      meeting_status: z.enum(["scheduled", "cancelled"]),
      lists: z.array(z.string()),
      answer: z
        .object({ status: z.string(), updated_at: z.string() })
        .nullable(),
      mark: z
        .object({ actual: z.string(), marked_by_name: z.string().nullable() })
        .nullable(),
    }),
  );
  const rows = async (workspaceId: string, year: number) => {
    const { data, error } = await adminClient().rpc("sheet_rows", {
      p_workspace: workspaceId,
      p_year: year,
    });
    if (error) {
      throw error;
    }
    return rowSchema.parse(data);
  };

  it("lists one year's sent meetings that ask for answers, newest first, then by name", async () => {
    const ws = await createWorkspaceAs(owner, "Rows Club");
    const newest = await seedMeeting(ws.id, {
      status: "scheduled",
      title: "Newest",
      starts_at: "2026-11-20T17:00:00Z",
    });
    const cancelled = await seedMeeting(ws.id, {
      status: "cancelled",
      title: "Cancelled",
      starts_at: "2026-06-01T17:00:00Z",
    });
    const announcement = await seedMeeting(ws.id, {
      status: "scheduled",
      response_mode: "announcement",
      starts_at: "2026-05-01T17:00:00Z",
    });
    const draft = await seedMeeting(ws.id, {
      status: "draft",
      starts_at: "2026-04-01T17:00:00Z",
    });
    const edge = await seedMeeting(ws.id, {
      status: "scheduled",
      title: "New Year's Eve",
      starts_at: "2026-12-31T23:30:00Z",
    });
    const zed = await person(ws.id, newest, "Zed");
    const amira = await person(ws.id, newest, "Amira");
    await person(ws.id, cancelled, "Badr");
    await person(ws.id, announcement, "Chams");
    await person(ws.id, draft, "Dora");
    await person(ws.id, edge, "Emna");
    const beta = await seedList(ws.id, "beta");
    const alpha = await seedList(ws.id, "Alpha");
    await addToList(ws.id, beta, [amira.contactId]);
    await addToList(ws.id, alpha, [amira.contactId]);
    await adminClient().from("responses").insert({
      workspace_id: ws.id,
      meeting_id: newest,
      invitee_id: amira.inviteeId,
      status: "attending",
    });
    await adminClient().from("attendance_marks").insert({
      workspace_id: ws.id,
      meeting_id: newest,
      invitee_id: zed.inviteeId,
      actual: "present",
      marked_by: owner.id,
    });

    const of2026 = await rows(ws.id, 2026);
    expect(of2026.map((row) => [row.title, row.full_name])).toEqual([
      ["Newest", "Amira"],
      ["Newest", "Zed"],
      ["Cancelled", "Badr"],
    ]);
    expect(of2026.map((row) => row.meeting_status)).toEqual([
      "scheduled",
      "scheduled",
      "cancelled",
    ]);
    expect(of2026[0].lists).toEqual(["Alpha", "beta"]);
    expect(of2026[0].answer?.status).toBe("attending");
    expect(of2026[1]).toMatchObject({
      answer: null,
      mark: { actual: "present", marked_by_name: "Worker Owner" },
    });
    expect((await rows(ws.id, 2027)).map((row) => row.title)).toEqual([
      "New Year's Eve",
    ]);
  });

  it("reads one year through the workspace's start index (2,000 contacts, 1,000 invitees)", async () => {
    const big = await seedMeeting(workspace.id, {
      status: "scheduled",
      starts_at: "2026-11-01T17:00:00Z",
    });
    const contacts = await seedContacts(workspace.id, 1998, "bulk");
    for (let start = 0; start < 1000; start += 500) {
      const { error } = await adminClient()
        .from("meeting_invitees")
        .insert(
          contacts.slice(start, start + 500).map((contactId) => ({
            workspace_id: workspace.id,
            meeting_id: big,
            contact_id: contactId,
            token_hash: crypto.randomUUID().replaceAll("-", "").repeat(2),
            email_status: "sent" as const,
          })),
        );
      if (error) {
        throw error;
      }
    }
    runLocalSql(
      "analyze public.meetings, public.meeting_invitees, public.contacts, public.responses, public.attendance_marks, public.list_contacts",
    );
    // A test database's meetings table is a few pages, where a full scan is rightly cheapest; with
    // full scans discouraged, the plan shows whether the query can use an index at all.
    const plan = explainCall(
      `public.sheet_rows('${workspace.id}', 2026)`,
      owner.id,
      "service_role",
      ["enable_seqscan = off"],
    );
    // Any index led by the workspace keeps the read to this workspace's meetings; which one wins on
    // a tiny table is a planner tie (CI and local differ).
    expect(
      [
        "meetings_workspace_starts_idx",
        "meetings_ws_status_starts_idx",
        "meetings_ws_status_updated_idx",
      ].some((index) => planUsesIndex(plan, index)),
      plan
        .split("\n")
        .find((line) => / on meetings | using meetings_/.test(line)) ??
        "no meetings scan",
    ).toBe(true);
    expect(plan).not.toMatch(/Seq Scan on meetings\b/);
    expect(planUsesIndex(plan, "meeting_invitees_meeting_ws_idx")).toBe(true);
  });
});

describe("workers_due (the per-minute wake-up)", () => {
  beforeEach(() => {
    parkAllJobs();
    parkAllSheets();
    parkAllPlatformEvents();
  });

  const job = (kind: "invite" | "update", inviteeId: string) =>
    adminClient()
      .from("outbox_jobs")
      .insert({
        kind,
        workspace_id: workspace.id,
        meeting_id: meeting,
        invitee_id: inviteeId,
        idempotency_key: `test-${crypto.randomUUID()}`,
      });

  it("is false with nothing due, and true with a due invite", async () => {
    expect(workersDue()).toBe(false);
    await job("invite", a.inviteeId);
    expect(workersDue()).toBe(true);
  });

  it("is false with only an update held behind a queued invite (#255)", async () => {
    const queued = await person(workspace.id, meeting, "Queued", "queued");
    await job("update", queued.inviteeId);
    expect(workersDue()).toBe(false);
  });

  it("finds due sheets through the due index, in the wake-up and in the claim (#291)", () => {
    // A tiny table makes a sequential scan rightly cheapest: prove the index can serve both reads.
    const dueByIndex = /Index Cond: \(retry_at <= now\(\)\)/;
    for (const [call, role] of [
      ["private.workers_due()", "postgres"],
      [`public.sheet_claim('${crypto.randomUUID()}', 5, 120)`, "service_role"],
    ] as const) {
      const plan = explainCall(call, owner.id, role, ["enable_seqscan = off"]);
      expect(planUsesIndex(plan, "sheet_syncs_due_idx")).toBe(true);
      expect(dueByIndex.test(plan)).toBe(true);
    }
  });

  it("is true with a due sheet", async () => {
    unparkSheet(workspace.id);
    await answer(a, "attending");
    expect(workersDue()).toBe(false);
    makeDue(workspace.id);
    expect(workersDue()).toBe(true);
  });
});
