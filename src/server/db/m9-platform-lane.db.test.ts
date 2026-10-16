import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { PLATFORM_EVENT_KINDS } from "@/lib/discord/platform-events";
import { adminClient, createTestUser } from "@/test/db/clients";
import { parkAllJobs } from "@/test/db/outbox";
import { parkAllPlatformEvents } from "@/test/db/platform";
import { queryLocalSql, runLocalSql } from "@/test/db/sql";
import { createWorkspaceAs } from "@/test/db/workspaces";

const claimRow = z.object({
  id: z.number(),
  kind: z.string(),
  workspace_slug: z.string().nullable(),
  attempts: z.number(),
});

beforeEach(() => runLocalSql("delete from public.platform_events"));

describe("platform events lane", () => {
  it("claims each event once while leased, and the done one never comes back", async () => {
    const owner = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "Lane Club");
    runLocalSql(
      `select private.open_suspension('${workspace.id}', 'platform_admin', null, '{}')`,
    );
    const admin = adminClient();
    const first = z.array(claimRow).parse(
      (
        await admin.rpc("platform_events_claim", {
          p_limit: 10,
          p_lease_seconds: 60,
        })
      ).data,
    );
    expect(first.map((event) => event.kind)).toEqual(["suspended"]);
    expect(first[0].workspace_slug).toBe(workspace.slug);
    const second = (
      await admin.rpc("platform_events_claim", {
        p_limit: 10,
        p_lease_seconds: 60,
      })
    ).data;
    expect(second).toEqual([]);
    await admin.rpc("platform_event_done", { p_event: first[0].id });
    runLocalSql(
      "update public.platform_events set locked_until = now() - interval '1 second'",
    );
    expect(
      (
        await admin.rpc("platform_events_claim", {
          p_limit: 10,
          p_lease_seconds: 60,
        })
      ).data,
    ).toEqual([]);
  });

  it("spends the Owner email budget once per event", async () => {
    const owner = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "Email Once");
    runLocalSql(
      `select private.open_suspension('${workspace.id}', 'platform_admin', null, '{}')`,
    );
    const [event] = z.array(claimRow).parse(
      (
        await adminClient().rpc("platform_events_claim", {
          p_limit: 1,
          p_lease_seconds: 60,
        })
      ).data,
    );
    const target = (
      await adminClient().rpc("platform_event_owner_target", {
        p_event: event.id,
      })
    ).data as { email: string } | null;
    expect(target?.email).toBe(owner.email);
    expect(
      (
        await adminClient().rpc("platform_event_owner_target", {
          p_event: event.id,
        })
      ).data,
    ).toBeNull();
  });

  it("gives up after the attempts cap", async () => {
    runLocalSql(
      `select private.record_platform_event('worker_failing', null, null, '{"lane":"emails"}')`,
    );
    const [event] = z.array(claimRow).parse(
      (
        await adminClient().rpc("platform_events_claim", {
          p_limit: 1,
          p_lease_seconds: 60,
        })
      ).data,
    );
    for (let i = 0; i < 5; i += 1) {
      await adminClient().rpc("platform_event_failed", { p_event: event.id });
    }
    const done = queryLocalSql(
      `select (notified_at is not null) as done from public.platform_events where id = ${event.id}`,
      z.array(z.object({ done: z.boolean() })).length(1),
    );
    expect(done[0].done).toBe(true);
  });

  it("is executable by the service role only", async () => {
    const user = await createTestUser();
    expect(
      (
        await user.client.rpc("platform_events_claim", {
          p_limit: 1,
          p_lease_seconds: 60,
        })
      ).error,
    ).not.toBeNull();
  });

  it("wakes the dispatcher while an event waits, not once it is handled", async () => {
    const due = () =>
      queryLocalSql(
        "select private.workers_due() as due",
        z.array(z.object({ due: z.boolean() })).length(1),
      )[0].due;
    parkAllJobs();
    runLocalSql(
      "update public.sheet_syncs set retry_at = now() + interval '1 day'",
    );
    runLocalSql("delete from public.push_deliveries");
    expect(due()).toBe(false);
    runLocalSql(
      `select private.record_platform_event('worker_failing', null, null, '{"lane":"emails"}')`,
    );
    expect(due()).toBe(true);
    parkAllPlatformEvents();
    expect(due()).toBe(false);
  });

  it("knows every event kind the database has, in its order (TS twin)", () => {
    const kinds = queryLocalSql(
      "select enum_range(null::public.platform_event_kind)::text[] as kinds",
      z.array(z.object({ kinds: z.array(z.string()) })).length(1),
    )[0].kinds;
    expect(kinds).toEqual([...PLATFORM_EVENT_KINDS]);
  });
});
