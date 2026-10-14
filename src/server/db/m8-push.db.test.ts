import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { hoursFromNow } from "@/test/db/meetings";
import { seedAnswer, seedContact, seedInviteFor } from "@/test/db/members";
import { overrideLimit, parkAllJobs, serviceRpc } from "@/test/db/outbox";
import { explainCall, planUsesIndex } from "@/test/db/plans";
import {
  allowFakePushHost,
  fakeSubscription,
  processingJob,
} from "@/test/db/push";
import { queryLocalSql, runLocalSql } from "@/test/db/sql";
import { createWorkspaceAs } from "@/test/db/workspaces";

const claimSchema = z.object({
  dropped: z.number().int(),
  items: z.array(
    z.object({
      id: z.uuid(),
      kind: z.string(),
      audience: z.string().nullable(),
      invitee_id: z.uuid(),
      endpoint: z.string(),
      attempts: z.number(),
    }),
  ),
});

async function subscribe(user: TestUser, sub = fakeSubscription()) {
  const { error } = await user.client.rpc("push_subscribe", {
    p_endpoint: sub.endpoint,
    p_p256dh: sub.p256dh,
    p_auth: sub.auth,
  } as never);
  if (error) {
    throw error;
  }
  return sub;
}

async function deliveriesFor(inviteeId: string) {
  const { data } = await adminClient()
    .from("push_deliveries")
    .select("id, kind, audience, subscription_id")
    .eq("invitee_id", inviteeId);
  return data ?? [];
}

async function finish(
  jobId: string,
  outcome: "sent" | "skipped" | "failed" | "unknown",
) {
  await serviceRpc("dispatch_finish", {
    p_job: jobId,
    p_outcome: outcome,
    p_error: null,
    p_token_hash:
      outcome === "sent"
        ? crypto.randomUUID().replaceAll("-", "").repeat(2)
        : null,
  });
}

beforeAll(() => allowFakePushHost());
beforeEach(() => {
  parkAllJobs();
});

describe("push subscriptions (spec §6, §11 Push privacy)", () => {
  it("moves an endpoint to whoever subscribes it last, dropping the old owner's pending pushes", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const organizer = await createTestUser();
    const club = await createWorkspaceAs(organizer);
    const sub = await subscribe(a);
    const invite = await seedInviteFor(
      club.id,
      await seedContact(club.id, a.email),
      { starts_at: hoursFromNow(24) },
    );
    await finish(
      await processingJob(
        club.id,
        invite.meetingId,
        invite.inviteeId,
        "invite",
      ),
      "sent",
    );
    expect(await deliveriesFor(invite.inviteeId)).toHaveLength(1);

    await subscribe(b, sub);

    const { data } = await adminClient()
      .from("push_subscriptions")
      .select("user_id")
      .eq("endpoint", sub.endpoint)
      .single();
    expect(data?.user_id).toBe(b.id);
    expect(await deliveriesFor(invite.inviteeId)).toHaveLength(0);
  });

  it("keeps at most push_devices_per_user_max per person, oldest out", async () => {
    const user = await createTestUser();
    const restore = overrideLimit("push_devices_per_user_max", 2);
    try {
      const first = await subscribe(user);
      await subscribe(user);
      await subscribe(user);
      const { data } = await adminClient()
        .from("push_subscriptions")
        .select("endpoint")
        .eq("user_id", user.id);
      expect(data?.map((row) => row.endpoint)).not.toContain(first.endpoint);
      expect(data).toHaveLength(2);
    } finally {
      restore();
    }
  });

  it("refuses a non-https endpoint, removes only the caller's own endpoint, and is rate limited", async () => {
    const user = await createTestUser();
    const other = await createTestUser();
    await expectAppError(
      user.client.rpc("push_subscribe", {
        p_endpoint: "http://push.example.test/x",
        p_p256dh: fakeSubscription().p256dh,
        p_auth: fakeSubscription().auth,
      } as never),
      "invalid_input",
    );
    // The table refuses it too, whoever writes.
    const direct = await adminClient().from("push_subscriptions").insert({
      user_id: user.id,
      endpoint: "http://push.example.test/x",
      p256dh: fakeSubscription().p256dh,
      auth: fakeSubscription().auth,
    });
    expect(direct.error?.code).toBe("23514");
    const sub = await subscribe(user);
    await other.client.rpc("push_unsubscribe", {
      p_endpoint: sub.endpoint,
    } as never);
    expect(
      (
        await adminClient()
          .from("push_subscriptions")
          .select("id")
          .eq("endpoint", sub.endpoint)
      ).data,
    ).toHaveLength(1);
    await user.client.rpc("push_unsubscribe", {
      p_endpoint: sub.endpoint,
    } as never);
    expect(
      (
        await adminClient()
          .from("push_subscriptions")
          .select("id")
          .eq("endpoint", sub.endpoint)
      ).data,
    ).toHaveLength(0);
    // One subscribe spent above; a limit of 1 refuses the next.
    const restore = overrideLimit("push_subscribes_per_user_per_hour", 1);
    try {
      await expectAppError(
        user.client.rpc("push_subscribe", {
          p_endpoint: fakeSubscription().endpoint,
          p_p256dh: fakeSubscription().p256dh,
          p_auth: fakeSubscription().auth,
        } as never),
        "rate_limited",
      );
    } finally {
      restore();
    }
  });

  it("accepts only the browsers' push services, so nobody can make the server call another site", async () => {
    const user = await createTestUser();
    const keys = fakeSubscription();
    const tryEndpoint = (endpoint: string) =>
      user.client.rpc("push_subscribe", {
        p_endpoint: endpoint,
        p_p256dh: keys.p256dh,
        p_auth: keys.auth,
      } as never);
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/abc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) {
      expect((await tryEndpoint(endpoint)).error, endpoint).toBeNull();
    }
    for (const endpoint of [
      "https://evil.example.test/x",
      "https://fcm.googleapis.com.evil.example.test/x",
      "https://fcm.googleapis.com@evil.example.test/x",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "https://169.254.169.254/latest/meta-data",
      "https://notify.windows.com.evil.example.test/x",
      // Hosts other URL parsers read differently: Node treats "\\" as "/" in https URLs, so the
      // first would reach evil.example.test while looking like an Apple subdomain here.
      "https://evil.example.test\\.push.apple.com/x",
      "https://evil.example.test%2f.push.apple.com/x",
      "https://evil.example.test\t.push.apple.com/x",
      "https://evil。push.apple.com/x",
    ]) {
      await expectAppError(tryEndpoint(endpoint), "invalid_input");
    }
  });

  it("gives signed-in people no direct access to either table", async () => {
    const user = await createTestUser();
    await subscribe(user);
    expect(
      (await user.client.from("push_subscriptions").select("id")).error,
    ).not.toBeNull();
    expect(
      (await user.client.from("push_deliveries").select("id")).error,
    ).not.toBeNull();
  });
});

describe("enqueue in dispatch_finish (spec §8: no email, no push)", () => {
  it("adds one delivery per device for a sent invite, update, cancel or reminder, and none for anything else", async () => {
    const organizer = await createTestUser();
    const member = await createTestUser();
    const club = await createWorkspaceAs(organizer);
    await subscribe(member);
    await subscribe(member);
    const contact = await seedContact(club.id, member.email);
    const invite = await seedInviteFor(club.id, contact, {
      starts_at: hoursFromNow(24),
    });
    const job = (kind: Parameters<typeof processingJob>[3], payload = {}) =>
      processingJob(club.id, invite.meetingId, invite.inviteeId, kind, payload);

    await finish(await job("invite"), "sent");
    await finish(await job("reminder", { audience: "going" }), "sent");
    await finish(
      await job("calendar_confirm", { action: "request", sequence: 0 }),
      "sent",
    );
    await finish(await job("update"), "skipped");
    await finish(await job("cancel"), "unknown");
    await finish(await job("update"), "failed");

    const rows = await deliveriesFor(invite.inviteeId);
    expect(
      rows.map((row) => `${row.kind}:${row.audience ?? ""}`).sort(),
    ).toEqual(["invite:", "invite:", "reminder:going", "reminder:going"]);
  });

  it("enqueues nothing for an unsubscribed person, nor twice for one job", async () => {
    const organizer = await createTestUser();
    const member = await createTestUser();
    const club = await createWorkspaceAs(organizer);
    await subscribe(member);
    const contact = await seedContact(club.id, member.email);
    const invite = await seedInviteFor(club.id, contact, {
      starts_at: hoursFromNow(24),
    });
    const jobId = await processingJob(
      club.id,
      invite.meetingId,
      invite.inviteeId,
      "invite",
    );
    await finish(jobId, "sent");
    await finish(jobId, "sent");
    expect(await deliveriesFor(invite.inviteeId)).toHaveLength(1);

    await adminClient()
      .from("contacts")
      .update({
        unsubscribed_at: new Date().toISOString(),
        unsubscribed_via: "link",
      })
      .eq("id", contact);
    await finish(
      await processingJob(
        club.id,
        invite.meetingId,
        invite.inviteeId,
        "cancel",
      ),
      "sent",
    );
    expect(await deliveriesFor(invite.inviteeId)).toHaveLength(1);
  });
});

describe("push_claim and results (spec §8 Push worker)", () => {
  async function queued(
    options: {
      meeting?: Parameters<typeof seedInviteFor>[2];
      kind?: Parameters<typeof processingJob>[3];
      payload?: Record<string, string>;
    } = {},
  ) {
    const organizer = await createTestUser();
    const member = await createTestUser();
    const club = await createWorkspaceAs(organizer);
    await subscribe(member);
    const invite = await seedInviteFor(
      club.id,
      await seedContact(club.id, member.email),
      {
        starts_at: hoursFromNow(24),
        ...options.meeting,
      },
    );
    await finish(
      await processingJob(
        club.id,
        invite.meetingId,
        invite.inviteeId,
        options.kind ?? "invite",
        options.payload ?? {},
      ),
      "sent",
    );
    return { club, invite, member };
  }
  const claim = async (run = crypto.randomUUID(), limit = 50) => ({
    run,
    ...claimSchema.parse(
      await serviceRpc("push_claim", {
        p_run: run,
        p_limit: limit,
        p_lease_seconds: 120,
      }),
    ),
  });

  it("drops what went stale: cancelled, started, or a pending reminder already answered; keeps cancellations", async () => {
    const cancelled = await queued();
    await adminClient()
      .from("meetings")
      .update({ status: "cancelled" })
      .eq("id", cancelled.invite.meetingId);
    const cancelNotice = await queued({ kind: "cancel" });
    await adminClient()
      .from("meetings")
      .update({ status: "cancelled" })
      .eq("id", cancelNotice.invite.meetingId);
    const answered = await queued({
      kind: "reminder",
      payload: { audience: "pending" },
    });
    await seedAnswer(
      answered.club.id,
      answered.invite.meetingId,
      answered.invite.inviteeId,
      { status: "attending" },
    );
    const started = await queued();
    await adminClient()
      .from("meetings")
      .update({ starts_at: hoursFromNow(-1) })
      .eq("id", started.invite.meetingId);
    const fresh = await queued();

    const result = await claim();
    expect(result.dropped).toBe(3);
    expect(result.items.map((item) => item.invitee_id).sort()).toEqual(
      [cancelNotice.invite.inviteeId, fresh.invite.inviteeId].sort(),
    );
  });

  it("never gives one delivery to two concurrent runs", async () => {
    for (let n = 0; n < 6; n += 1) {
      await queued();
    }
    const [one, two] = await Promise.all([
      claim(undefined, 4),
      claim(undefined, 4),
    ]);
    const ids = [...one.items, ...two.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
  });

  it("done deletes and stamps the device; retry backs off and gives up; gone removes the device", async () => {
    const a = await queued();
    const b = await queued();
    const c = await queued();
    const { run, items } = await claim();
    const byInvitee = (inviteeId: string) =>
      items.find((item) => item.invitee_id === inviteeId)?.id ?? "";

    expect(
      await serviceRpc("push_done", {
        p_delivery: byInvitee(a.invite.inviteeId),
        p_run: run,
      }),
    ).toBe(true);
    const stamped = await adminClient()
      .from("push_subscriptions")
      .select("last_success_at")
      .eq("user_id", a.member.id)
      .single();
    expect(stamped.data?.last_success_at).not.toBeNull();

    expect(
      await serviceRpc("push_retry", {
        p_delivery: byInvitee(b.invite.inviteeId),
        p_run: crypto.randomUUID(),
        p_after_seconds: 60,
      }),
    ).toBe(false);
    expect(
      await serviceRpc("push_retry", {
        p_delivery: byInvitee(b.invite.inviteeId),
        p_run: run,
        p_after_seconds: 60,
      }),
    ).toBe(true);
    const [row] = queryLocalSql(
      `select run_after > now() + interval '50 seconds' as later, locked_until is null as free from public.push_deliveries where id = '${byInvitee(b.invite.inviteeId)}'`,
      z.array(z.object({ later: z.boolean(), free: z.boolean() })).length(1),
    );
    expect(row).toEqual({ later: true, free: true });

    await serviceRpc("push_gone", {
      p_delivery: byInvitee(c.invite.inviteeId),
      p_run: run,
    });
    expect(
      (
        await adminClient()
          .from("push_subscriptions")
          .select("id")
          .eq("user_id", c.member.id)
      ).data,
    ).toEqual([]);
  });

  it("gives up after push_attempts_max", async () => {
    const restore = overrideLimit("push_attempts_max", 1);
    try {
      const a = await queued();
      const { run, items } = await claim();
      expect(
        await serviceRpc("push_retry", {
          p_delivery: items[0].id,
          p_run: run,
          p_after_seconds: 1,
        }),
      ).toBe(false);
      expect(await deliveriesFor(a.invite.inviteeId)).toEqual([]);
    } finally {
      restore();
    }
  });

  it("drops a delivery whose runs keep losing the lease once its attempts are spent", async () => {
    const restore = overrideLimit("push_attempts_max", 2);
    try {
      const a = await queued();
      // Two runs claim it and never report back (crash or timeout): the lease simply expires.
      for (let n = 0; n < 2; n += 1) {
        await claim();
        runLocalSql(
          "update public.push_deliveries set locked_until = now() - interval '1 second'",
        );
      }
      const third = await claim();
      expect(third.items).toEqual([]);
      expect(third.dropped).toBe(1);
      expect(await deliveriesFor(a.invite.inviteeId)).toEqual([]);
    } finally {
      restore();
    }
  });

  it("wakes the dispatcher only while a delivery is due", async () => {
    parkAllJobs();
    runLocalSql(
      "update public.sheet_syncs set retry_at = now() + interval '1 day'",
    );
    await queued();
    const due = () =>
      queryLocalSql(
        "select private.workers_due() as due",
        z.array(z.object({ due: z.boolean() })).length(1),
      )[0].due;
    expect(due()).toBe(true);
    const { run, items } = await claim();
    for (const item of items) {
      await serviceRpc("push_done", { p_delivery: item.id, p_run: run });
    }
    expect(due()).toBe(false);
  });

  it("housekeeping removes idle devices and old deliveries", async () => {
    const a = await queued();
    runLocalSql(
      `update public.push_subscriptions set created_at = now() - interval '91 days', last_success_at = null where user_id = '${a.member.id}'`,
    );
    runLocalSql(
      "update public.push_deliveries set created_at = now() - interval '2 days'",
    );
    runLocalSql("select private.housekeeping()");
    expect(
      (
        await adminClient()
          .from("push_subscriptions")
          .select("id")
          .eq("user_id", a.member.id)
      ).data,
    ).toEqual([]);
    expect(
      (await adminClient().from("push_deliveries").select("id")).data,
    ).toEqual([]);
  });

  it("claims through the run_after index", async () => {
    await queued();
    const planUser = await createTestUser();
    const claimPlan = explainCall(
      `public.push_claim('${crypto.randomUUID()}', 10, 60)`,
      planUser.id,
      "service_role",
      ["enable_seqscan = off"],
    );
    expect(planUsesIndex(claimPlan, "push_deliveries_run_after_idx")).toBe(
      true,
    );
  });
});
