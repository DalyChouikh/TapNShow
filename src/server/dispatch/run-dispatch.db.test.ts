import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveInviteeToken,
  inviteeTokenHash,
} from "@/server/crypto/invitee-token";
import {
  connectionAssociatedData,
  openSecret,
  sealSecret,
} from "@/server/crypto/secret-box";
import type { GmailSendResult } from "@/server/gmail/gmail-client";
import { createDispatchStore } from "@/server/queries/dispatch";
import { adminClient, createTestUser, type TestUser } from "@/test/db/clients";
import { addToList, seedMeeting } from "@/test/db/meetings";
import { overrideLimit } from "@/test/db/outbox";
import { seedContacts, seedList } from "@/test/db/roster";
import { setSender } from "@/test/db/sender";
import { runLocalSql } from "@/test/db/sql";
import { createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";
import { runDispatch, type DispatchDeps } from "./run-dispatch";

const KEY = randomBytes(32);
const SECRET = "i".repeat(43);
const OPTIONS = {
  budgetMs: 50_000,
  paceMs: 0,
  batchSize: 50,
  leaseSeconds: 70,
};

let owner: TestUser;
let workspace: TestWorkspace;
let connection: string;
let meeting: string;
const restore: Array<() => void> = [];

beforeEach(async () => {
  runLocalSql(
    "update public.outbox_jobs set status = 'done' where status in ('pending', 'processing', 'paused')",
  );
  runLocalSql("delete from public.sender_leases");
  owner = await createTestUser({ fullName: "Owner" });
  workspace = await createWorkspaceAs(owner, "Dispatch Club");
  const sub = `sub-${crypto.randomUUID()}`;
  const saved = await adminClient().rpc("save_google_connection", {
    p_user: owner.id,
    p_google_sub: sub,
    p_google_email: "club@gmail.com",
    p_scopes: ["https://www.googleapis.com/auth/gmail.send"],
    p_token_encrypted: sealSecret(
      "1//refresh",
      KEY,
      connectionAssociatedData(owner.id, sub),
    ),
  });
  connection = saved.data ?? "";
  await setSender(workspace.id, connection);
  const people = await seedContacts(
    workspace.id,
    3,
    `dp-${crypto.randomUUID().slice(0, 6)}`,
  );
  const list = await seedList(workspace.id, "Members");
  await addToList(workspace.id, list, people);
  meeting = await seedMeeting(workspace.id, { created_by: owner.id });
  await owner.client.rpc("set_meeting_audience", {
    p_meeting: meeting,
    p_list_ids: [list],
    p_include: [],
    p_exclude: [],
  });
});

afterEach(() => {
  while (restore.length) {
    restore.pop()?.();
  }
});

function deps(
  gmail: (threadId: string | null) => GmailSendResult,
): DispatchDeps {
  return {
    store: createDispatchStore(adminClient()),
    gmail: vi.fn<DispatchDeps["gmail"]>(async ({ threadId }) =>
      gmail(threadId),
    ),
    refresh: vi.fn<DispatchDeps["refresh"]>(async () => ({
      kind: "ok",
      accessToken: "at",
    })),
    openToken: (sealed, userId, sub) =>
      openSecret(sealed, KEY, connectionAssociatedData(userId, sub)),
    tokenFor: (id) => deriveInviteeToken(id, SECRET),
    appUrl: "https://tapnshow.vercel.app",
    now: () => Date.now(),
    sleep: async () => undefined,
    alertBroken: vi.fn<DispatchDeps["alertBroken"]>(async () => undefined),
    newRunId: () => crypto.randomUUID(),
  };
}

describe("dispatcher against the database", () => {
  it("sends every invite once, threads them, and stores token hashes", async () => {
    await owner.client.rpc("send_meeting", { p_meeting: meeting });
    let n = 0;
    const d = deps((threadId) => ({
      kind: "sent",
      id: `m${(n += 1)}`,
      threadId: threadId ?? "t-1",
    }));
    expect((await runDispatch(d, OPTIONS)).sent).toBe(3);
    expect((await runDispatch(d, OPTIONS)).sent).toBe(0);
    const invitees = await adminClient()
      .from("meeting_invitees")
      .select("id, email_status, token_hash")
      .eq("meeting_id", meeting);
    expect(invitees.data?.every((i) => i.email_status === "sent")).toBe(true);
    for (const invitee of invitees.data ?? []) {
      expect(invitee.token_hash).toBe(
        inviteeTokenHash(deriveInviteeToken(invitee.id, SECRET)),
      );
    }
    const row = await adminClient()
      .from("meetings")
      .select("gmail_thread_id, thread_connection_id")
      .eq("id", meeting)
      .single();
    expect(row.data).toEqual({
      gmail_thread_id: "t-1",
      thread_connection_id: connection,
    });
    const threadIds = vi
      .mocked(d.gmail)
      .mock.calls.map(([input]) => input.threadId);
    expect(threadIds).toEqual([null, "t-1", "t-1"]);
  });

  it("skips a person who unsubscribed between Send and their turn", async () => {
    await owner.client.rpc("send_meeting", { p_meeting: meeting });
    const { data: first } = await adminClient()
      .from("meeting_invitees")
      .select("contact_id")
      .eq("meeting_id", meeting)
      .limit(1)
      .single();
    await adminClient()
      .from("contacts")
      .update({
        unsubscribed_at: new Date().toISOString(),
        unsubscribed_via: "link",
      })
      .eq("id", first?.contact_id ?? "");
    const summary = await runDispatch(
      deps(() => ({ kind: "sent", id: "m", threadId: "t" })),
      OPTIONS,
    );
    expect(summary).toMatchObject({ sent: 2, skipped: 1 });
  });

  it("holds the daily cap", async () => {
    restore.push(overrideLimit("gmail_sends_per_day", 1));
    await owner.client.rpc("send_meeting", { p_meeting: meeting });
    const summary = await runDispatch(
      deps(() => ({ kind: "sent", id: "m", threadId: "t" })),
      OPTIONS,
    );
    expect(summary.sent).toBe(1);
    const pending = await adminClient()
      .from("outbox_jobs")
      .select("run_after")
      .eq("workspace_id", workspace.id)
      .eq("status", "pending");
    expect(pending.data?.length).toBe(2);
    expect(
      new Date(pending.data?.[0].run_after ?? 0).getTime(),
    ).toBeGreaterThan(Date.now() + 23 * 3600_000);
  });
});
