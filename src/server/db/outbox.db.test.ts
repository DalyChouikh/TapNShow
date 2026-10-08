import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { addToList, seedMeeting } from "@/test/db/meetings";
import { jobsOf, overrideLimit, serviceRpc } from "@/test/db/outbox";
import { seedContacts, seedList } from "@/test/db/roster";
import { seedConnection, setSender } from "@/test/db/sender";
import { queryLocalSql, runLocalSql } from "@/test/db/sql";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

const claimSchema = z
  .object({
    connection: z.object({
      id: z.uuid(),
      google_sub: z.string(),
      google_email: z.string(),
      refresh_token_encrypted: z.string(),
      user_id: z.uuid(),
    }),
    jobs: z.array(
      z
        .object({
          job_id: z.uuid(),
          attempts: z.number(),
          invitee_id: z.uuid(),
          workspace_name: z.string(),
          contact: z.object({ full_name: z.string(), email: z.string() }),
          meeting: z
            .object({
              id: z.uuid(),
              title: z.string(),
              thread_id: z.string().nullable(),
            })
            .loose(),
        })
        .loose(),
    ),
  })
  .nullable();

let owner: TestUser;
let admin: TestUser;
let viewer: TestUser;
let workspace: TestWorkspace;
let connection: string;
let sub: string;
let meeting: string;
let contacts: string[];
const restore: Array<() => void> = [];

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  admin = await createTestUser({ fullName: "Admin" });
  viewer = await createTestUser({ fullName: "Viewer" });
  workspace = await createWorkspaceAs(owner, "Outbox Club");
  await addMember(workspace.id, admin.id, "admin");
  await addMember(workspace.id, viewer.id, "viewer");
  sub = `sub-${crypto.randomUUID()}`;
  connection = await seedConnection(owner.id, { sub });
  await setSender(workspace.id, connection);
  contacts = await seedContacts(
    workspace.id,
    3,
    `ob-${crypto.randomUUID().slice(0, 6)}`,
  );
  const list = await seedList(workspace.id, "Members");
  await addToList(workspace.id, list, contacts);
  meeting = await seedMeeting(workspace.id, { created_by: admin.id });
  await admin.client.rpc("set_meeting_audience", {
    p_meeting: meeting,
    p_list_ids: [list],
    p_include: [],
    p_exclude: [],
  });
  // Earlier tests may leave due jobs from other workspaces; park them so claims only see ours.
  runLocalSql(
    "update public.outbox_jobs set status = 'done' where status in ('pending', 'processing')",
  );
  runLocalSql("delete from public.sender_leases");
});

afterEach(() => {
  while (restore.length) {
    restore.pop()?.();
  }
});

const claim = async (run = crypto.randomUUID(), limit = 10) =>
  claimSchema.parse(
    await serviceRpc("dispatch_claim", {
      p_run: run,
      p_limit: limit,
      p_lease_seconds: 70,
    }),
  );

describe("send_meeting", () => {
  it("snapshots the audience into invitees and one invite job each, once", async () => {
    await adminClient()
      .from("contacts")
      .update({
        unsubscribed_at: new Date().toISOString(),
        unsubscribed_via: "link",
      })
      .eq("id", contacts[2]);
    const sent = await admin.client.rpc("send_meeting", { p_meeting: meeting });
    expect(sent.data).toEqual({ invited: 2, skipped_unsubscribed: 1 });
    const jobs = await jobsOf(meeting);
    expect(jobs).toHaveLength(2);
    expect(
      jobs.every(
        (j) =>
          j.status === "pending" &&
          j.idempotency_key === `invite:${j.invitee_id}`,
      ),
    ).toBe(true);
    const row = await adminClient()
      .from("meetings")
      .select("status, sent_at")
      .eq("id", meeting)
      .single();
    expect(row.data?.status).toBe("scheduled");
    expect(row.data?.sent_at).not.toBeNull();
    await expectAppError(
      admin.client.rpc("send_meeting", { p_meeting: meeting }),
      "nothing_to_send",
    );
    await expectAppError(
      viewer.client.rpc("send_meeting", { p_meeting: meeting }),
      "forbidden",
    );
  });

  it("invites only the new people on Invite more", async () => {
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    const [extra] = await seedContacts(
      workspace.id,
      1,
      `extra-${crypto.randomUUID().slice(0, 6)}`,
    );
    const { data: current } = await admin.client
      .from("meeting_audience")
      .select("list_id")
      .eq("meeting_id", meeting);
    await admin.client.rpc("set_meeting_audience", {
      p_meeting: meeting,
      p_list_ids: (current ?? []).map((r) => r.list_id),
      p_include: [extra],
      p_exclude: [],
    });
    expect(
      (await admin.client.rpc("send_meeting", { p_meeting: meeting })).data,
    ).toEqual({ invited: 1, skipped_unsubscribed: 0 });
    expect(await jobsOf(meeting)).toHaveLength(4);
  });

  it("refuses incomplete, past, sender-less and broken-sender meetings", async () => {
    await adminClient()
      .from("meetings")
      .update({ title: "" })
      .eq("id", meeting);
    await expectAppError(
      admin.client.rpc("send_meeting", { p_meeting: meeting }),
      "meeting_incomplete",
    );
    await adminClient()
      .from("meetings")
      .update({ title: "Sync", location_mode: "online", meeting_url: "" })
      .eq("id", meeting);
    await expectAppError(
      admin.client.rpc("send_meeting", { p_meeting: meeting }),
      "meeting_incomplete",
    );
    await adminClient()
      .from("meetings")
      .update({
        location_mode: "in_person",
        starts_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .eq("id", meeting);
    await expectAppError(
      admin.client.rpc("send_meeting", { p_meeting: meeting }),
      "meeting_in_past",
    );
    await adminClient()
      .from("meetings")
      .update({ starts_at: new Date(Date.now() + 86_400_000).toISOString() })
      .eq("id", meeting);
    await setSender(workspace.id, null);
    await expectAppError(
      admin.client.rpc("send_meeting", { p_meeting: meeting }),
      "sender_not_connected",
    );
    await setSender(workspace.id, connection);
    await adminClient()
      .from("google_connections")
      .update({ status: "broken" })
      .eq("id", connection);
    await expectAppError(
      admin.client.rpc("send_meeting", { p_meeting: meeting }),
      "sender_broken",
    );
  });
});

describe("dispatcher claim and leases", () => {
  it("gives a sender's jobs to one run at a time", async () => {
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    const [a, b] = await Promise.all([claim(), claim()]);
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.connection).toMatchObject({
      id: connection,
      google_sub: sub,
    });
    expect(winners[0]?.jobs).toHaveLength(3);
    expect(winners[0]?.jobs[0].workspace_name).toBe("Outbox Club");
  });

  it("turns an expired lease into 'unknown' when sending had started, and retries otherwise", async () => {
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    const first = await claim(crypto.randomUUID(), 2);
    const [started, notStarted] = first?.jobs ?? [];
    expect(
      await serviceRpc("dispatch_reserve", { p_job: started.job_id }),
    ).toEqual({ kind: "ok" });
    runLocalSql(
      "update public.outbox_jobs set locked_until = now() - interval '1 second' where status = 'processing'",
    );
    runLocalSql("delete from public.sender_leases");
    const second = await claim();
    const ids = (second?.jobs ?? []).map((j) => j.job_id);
    expect(ids).toContain(notStarted.job_id);
    expect(ids).not.toContain(started.job_id);
    const invitee = await adminClient()
      .from("meeting_invitees")
      .select("email_status")
      .eq("id", started.invitee_id)
      .single();
    expect(invitee.data?.email_status).toBe("unknown");
  });

  it("pauses jobs without a sender and resumes them when one is set", async () => {
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    await setSender(workspace.id, null);
    expect(await claim()).toBeNull();
    expect((await jobsOf(meeting)).every((j) => j.status === "paused")).toBe(
      true,
    );
    await setSender(workspace.id, connection);
    expect((await jobsOf(meeting)).every((j) => j.status === "pending")).toBe(
      true,
    );
  });
});

describe("quota reservations", () => {
  it("never lets two concurrent reserves pass the daily cap", async () => {
    restore.push(overrideLimit("gmail_sends_per_day", 2));
    await adminClient()
      .from("send_log")
      .insert({ google_sub: sub, workspace_id: workspace.id });
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    const claimed = await claim();
    const [x, y] = claimed?.jobs ?? [];
    const results = await Promise.all([
      serviceRpc("dispatch_reserve", { p_job: x.job_id }),
      serviceRpc("dispatch_reserve", { p_job: y.job_id }),
    ]);
    const kinds = results
      .map((r) => z.object({ kind: z.string() }).loose().parse(r).kind)
      .sort();
    expect(kinds).toEqual(["ok", "quota"]);
    const deferred = (await jobsOf(meeting)).find(
      (j) => j.status === "pending",
    );
    expect(new Date(deferred?.run_after ?? 0).getTime()).toBeGreaterThan(
      Date.now() + 23 * 3600_000,
    );
  });

  it("finishes skipped people at reserve time", async () => {
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    const claimed = await claim();
    const target = claimed?.jobs[0];
    const { data: invitee } = await adminClient()
      .from("meeting_invitees")
      .select("contact_id")
      .eq("id", target?.invitee_id ?? "")
      .single();
    await adminClient()
      .from("contacts")
      .update({
        unsubscribed_at: new Date().toISOString(),
        unsubscribed_via: "link",
      })
      .eq("id", invitee?.contact_id ?? "");
    expect(
      await serviceRpc("dispatch_reserve", { p_job: target?.job_id ?? "" }),
    ).toEqual({ kind: "done" });
    const row = await adminClient()
      .from("meeting_invitees")
      .select("email_status")
      .eq("id", target?.invitee_id ?? "")
      .single();
    expect(row.data?.email_status).toBe("skipped");
  });
});

describe("finish, retry, defer, broken", () => {
  // token_hash is unique and rows outlive test runs, so each run uses its own hash.
  const tokenHash = crypto.randomUUID().replaceAll("-", "").repeat(2);

  it("stores the token hash when the send starts, so an unknown outcome keeps working links", async () => {
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    const [job] = (await claim())?.jobs ?? [];
    const hash = crypto.randomUUID().replaceAll("-", "").repeat(2);
    await serviceRpc("dispatch_reserve", {
      p_job: job.job_id,
      p_token_hash: hash,
    });
    await serviceRpc("dispatch_finish", {
      p_job: job.job_id,
      p_outcome: "unknown",
      p_error: "delivery_unknown",
      p_token_hash: null,
    });
    const row = await adminClient()
      .from("meeting_invitees")
      .select("email_status, token_hash")
      .eq("id", job.invitee_id)
      .single();
    expect(row.data).toEqual({ email_status: "unknown", token_hash: hash });
  });

  it("records a sent invite with its token hash and releases a failed one", async () => {
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    const [ok, bad] = (await claim())?.jobs ?? [];
    await serviceRpc("dispatch_reserve", { p_job: ok.job_id });
    await serviceRpc("dispatch_finish", {
      p_job: ok.job_id,
      p_outcome: "sent",
      p_error: null,
      p_token_hash: tokenHash,
    });
    await serviceRpc("dispatch_reserve", { p_job: bad.job_id });
    await serviceRpc("dispatch_finish", {
      p_job: bad.job_id,
      p_outcome: "failed",
      p_error: "invalid_recipient",
      p_token_hash: null,
    });
    const rows = await adminClient()
      .from("meeting_invitees")
      .select("id, email_status, token_hash, sent_at")
      .in("id", [ok.invitee_id, bad.invitee_id]);
    expect(rows.data?.find((r) => r.id === ok.invitee_id)).toMatchObject({
      email_status: "sent",
      token_hash: tokenHash,
    });
    expect(rows.data?.find((r) => r.id === bad.invitee_id)).toMatchObject({
      email_status: "failed",
      token_hash: null,
    });
    const log = await adminClient()
      .from("send_log")
      .select("job_id")
      .eq("google_sub", sub);
    expect(log.data?.map((r) => r.job_id)).toEqual([ok.job_id]);
  });

  it("backs off 1, 2, 4, 8, 16 minutes, then fails", async () => {
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    let job = (await claim(crypto.randomUUID(), 1))?.jobs[0];
    // Keep only this job in play so each claim picks it again.
    runLocalSql(
      "update public.outbox_jobs set status = 'done' where status = 'pending'",
    );
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const result = z
        .object({ kind: z.string(), retry_at: z.string().optional() })
        .parse(
          await serviceRpc("dispatch_retry", {
            p_job: job?.job_id ?? "",
            p_error: "http_503",
          }),
        );
      if (result.kind === "failed") {
        expect(attempt).toBe(6);
        break;
      }
      delays.push(
        Math.round(
          (new Date(result.retry_at ?? 0).getTime() - Date.now()) / 60_000,
        ),
      );
      runLocalSql(
        `update public.outbox_jobs set run_after = now() where id = '${job?.job_id}'`,
      );
      runLocalSql("delete from public.sender_leases");
      job = (await claim(crypto.randomUUID(), 1))?.jobs[0];
    }
    expect(delays).toEqual([1, 2, 4, 8, 16]);
  });

  it("defers a throttled sender and pauses a broken one, alerting the Owner once", async () => {
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    const run = crypto.randomUUID();
    const claimed = await claim(run);
    const until = new Date(Date.now() + 3600_000).toISOString();
    await serviceRpc("dispatch_defer_sender", {
      p_run: run,
      p_connection: connection,
      p_until: until,
      p_error: "gmail_throttled",
    });
    expect(
      (await jobsOf(meeting)).every(
        (j) => j.status === "pending" && j.attempts === 0,
      ),
    ).toBe(true);
    runLocalSql(
      "update public.outbox_jobs set run_after = now() where status = 'pending'",
    );
    runLocalSql("delete from public.sender_leases");
    const run2 = crypto.randomUUID();
    await claim(run2);
    const broken = z
      .object({
        newly_broken: z.boolean(),
        alert: z.array(
          z.object({
            email: z.string(),
            workspace_name: z.string(),
            workspace_slug: z.string(),
          }),
        ),
      })
      .parse(
        await serviceRpc("dispatch_mark_broken", {
          p_run: run2,
          p_connection: connection,
          p_reason: "invalid_grant",
        }),
      );
    expect(broken.newly_broken).toBe(true);
    expect(broken.alert).toEqual([
      {
        email: owner.email,
        workspace_name: "Outbox Club",
        workspace_slug: workspace.slug,
      },
    ]);
    expect((await jobsOf(meeting)).every((j) => j.status === "paused")).toBe(
      true,
    );
    const again = z
      .object({ newly_broken: z.boolean() })
      .loose()
      .parse(
        await serviceRpc("dispatch_mark_broken", {
          p_run: run2,
          p_connection: connection,
          p_reason: "invalid_grant",
        }),
      );
    expect(again.newly_broken).toBe(false);
    await adminClient().rpc("save_google_connection", {
      p_user: owner.id,
      p_google_sub: sub,
      p_google_email: "club@gmail.com",
      p_scopes: ["https://www.googleapis.com/auth/gmail.send"],
      p_token_encrypted: "v1.n.e.w",
    });
    expect((await jobsOf(meeting)).every((j) => j.status === "pending")).toBe(
      true,
    );
    expect(claimed).not.toBeNull();
  });
});

describe("meeting_progress", () => {
  it("shows counts, deferral time and sender state to members only", async () => {
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    const until = new Date(Date.now() + 3600_000).toISOString();
    runLocalSql(
      `update public.outbox_jobs set run_after = '${until}' where invitee_id in (select id from public.meeting_invitees where meeting_id = '${meeting}')`,
    );
    const { data } = await viewer.client.rpc("meeting_progress", {
      p_meeting: meeting,
    });
    const progress = z
      .object({
        counts: z
          .object({ total: z.number(), queued: z.number(), sent: z.number() })
          .loose(),
        paused: z.number(),
        resumes_at: z.string().nullable(),
        sender_state: z.string(),
        invitees: z.array(
          z.object({ full_name: z.string(), status: z.string() }).loose(),
        ),
      })
      .parse(data);
    expect(progress.counts).toMatchObject({ total: 3, queued: 3, sent: 0 });
    expect(new Date(progress.resumes_at ?? 0).toISOString()).toBe(
      new Date(until).toISOString(),
    );
    expect(progress.sender_state).toBe("ok");
    expect(progress.invitees).toHaveLength(3);
    const outsider = await createTestUser();
    await expectAppError(
      outsider.client.rpc("meeting_progress", { p_meeting: meeting }),
      "not_found",
    );
  });
});

describe("cron kick and security", () => {
  it("calls the dispatcher only when jobs are due and Vault is configured", async () => {
    // pg_net moves requests from its queue to its response table in the background, so count both
    // and poll briefly instead of asserting on one table at one instant.
    const requests = () =>
      queryLocalSql(
        "select ((select count(*) from net.http_request_queue) + (select count(*) from net._http_response))::int as n",
        z.array(z.object({ n: z.number() })),
      )[0].n;
    const eventually = async (check: () => boolean) => {
      for (let i = 0; i < 25 && !check(); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return check();
    };
    await admin.client.rpc("send_meeting", { p_meeting: meeting });
    const before = requests();
    runLocalSql("select private.kick_dispatcher()");
    expect(requests()).toBe(before);
    runLocalSql(
      "select vault.create_secret('http://127.0.0.1:9/api/internal/dispatch', 'tn_dispatch_url'), vault.create_secret('test-secret', 'tn_dispatch_secret')",
    );
    try {
      runLocalSql("select private.kick_dispatcher()");
      expect(await eventually(() => requests() > before)).toBe(true);
    } finally {
      runLocalSql(
        "delete from vault.secrets where name in ('tn_dispatch_url', 'tn_dispatch_secret')",
      );
    }
  });

  it("cleans up empty drafts after a day and keeps everything else", async () => {
    const empty = await seedMeeting(workspace.id, {
      title: "",
      starts_at: null,
    });
    const named = await seedMeeting(workspace.id, {
      title: "Named",
      starts_at: null,
    });
    const fresh = await seedMeeting(workspace.id, {
      title: "",
      starts_at: null,
    });
    runLocalSql(
      `update public.meetings set created_at = now() - interval '25 hours' where id in ('${empty}', '${named}')`,
    );
    runLocalSql("select private.housekeeping()");
    const { data } = await adminClient()
      .from("meetings")
      .select("id")
      .in("id", [empty, named, fresh]);
    expect((data ?? []).map((r) => r.id).sort()).toEqual([named, fresh].sort());
  });

  it("keeps dispatcher functions away from signed-in users", async () => {
    const result = await admin.client.rpc("dispatch_claim", {
      p_run: crypto.randomUUID(),
      p_limit: 1,
      p_lease_seconds: 70,
    });
    expect(result.error?.code).toBe("42501");
    const jobs = await admin.client.from("outbox_jobs").select("id");
    expect(jobs.error?.code).toBe("42501");
  });
});
