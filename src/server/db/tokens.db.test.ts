import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminClient,
  anonClient,
  createTestUser,
  type TestUser,
} from "@/test/db/clients";
import { seedMeeting } from "@/test/db/meetings";
import { overrideLimit } from "@/test/db/outbox";
import { seedContacts } from "@/test/db/roster";
import { createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

let owner: TestUser;
let workspace: TestWorkspace;
let contact: string;
let hash: string;
const restore: Array<() => void> = [];

const inviteeSchema = z
  .object({
    invitee_id: z.uuid(),
    workspace_name: z.string(),
    masked_email: z.string(),
    unsubscribed: z.boolean(),
    reported: z.boolean(),
    meeting: z
      .object({ title: z.string(), status: z.string(), timezone: z.string() })
      .loose(),
  })
  .nullable();

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  workspace = await createWorkspaceAs(owner, "Token Club");
  [contact] = await seedContacts(
    workspace.id,
    1,
    `tok-${crypto.randomUUID().slice(0, 6)}`,
  );
  const meeting = await seedMeeting(workspace.id, {
    status: "scheduled",
    title: "Kickoff",
  });
  hash = crypto.randomUUID().replaceAll("-", "").repeat(2);
  const { error } = await adminClient().from("meeting_invitees").insert({
    workspace_id: workspace.id,
    meeting_id: meeting,
    contact_id: contact,
    token_hash: hash,
    email_status: "sent",
  });
  if (error) {
    throw error;
  }
});

afterEach(() => {
  while (restore.length) {
    restore.pop()?.();
  }
});

const call = async (
  name: "token_invitee" | "token_unsubscribe" | "token_resubscribe",
  args: Record<string, string>,
) => {
  const { data, error } = await adminClient().rpc(name, args as never);
  if (error) {
    throw error;
  }
  return data;
};

describe("token_invitee", () => {
  it("returns only what the public pages need", async () => {
    const info = inviteeSchema.parse(
      await call("token_invitee", { p_token_hash: hash }),
    );
    expect(info).toMatchObject({
      workspace_name: "Token Club",
      unsubscribed: false,
      reported: false,
    });
    expect(info?.masked_email).toMatch(/•/);
    expect(info?.meeting.title).toBe("Kickoff");
    expect(
      await call("token_invitee", { p_token_hash: "0".repeat(64) }),
    ).toBeNull();
  });
});

describe("unsubscribe, report, resubscribe", () => {
  it("unsubscribes by link, upgrades to a report once, and lets the person come back", async () => {
    expect(
      await call("token_unsubscribe", { p_token_hash: hash, p_via: "link" }),
    ).toBe(true);
    let row = await adminClient()
      .from("contacts")
      .select("unsubscribed_at, unsubscribed_via")
      .eq("id", contact)
      .single();
    expect(row.data?.unsubscribed_via).toBe("link");
    expect(
      await call("token_unsubscribe", { p_token_hash: hash, p_via: "report" }),
    ).toBe(true);
    expect(
      await call("token_unsubscribe", { p_token_hash: hash, p_via: "report" }),
    ).toBe(true);
    row = await adminClient()
      .from("contacts")
      .select("unsubscribed_at, unsubscribed_via")
      .eq("id", contact)
      .single();
    expect(row.data?.unsubscribed_via).toBe("report");
    const reports = await adminClient()
      .from("abuse_reports")
      .select("id")
      .eq("workspace_id", workspace.id);
    expect(reports.data).toHaveLength(1);
    expect(
      inviteeSchema.parse(await call("token_invitee", { p_token_hash: hash })),
    ).toMatchObject({ unsubscribed: true, reported: true });
    expect(await call("token_resubscribe", { p_token_hash: hash })).toBe(true);
    row = await adminClient()
      .from("contacts")
      .select("unsubscribed_at, unsubscribed_via")
      .eq("id", contact)
      .single();
    expect(row.data).toEqual({ unsubscribed_at: null, unsubscribed_via: null });
    expect(
      await call("token_unsubscribe", {
        p_token_hash: "0".repeat(64),
        p_via: "link",
      }),
    ).toBe(false);
  });

  it("shows the flags on the roster", async () => {
    await call("token_unsubscribe", { p_token_hash: hash, p_via: "report" });
    const { data } = await owner.client.rpc("roster", {
      p_workspace: workspace.id,
    });
    const roster = z
      .object({
        contacts: z.array(
          z
            .object({
              id: z.uuid(),
              unsubscribed: z.boolean(),
              reported: z.boolean(),
            })
            .loose(),
        ),
      })
      .loose()
      .parse(data);
    expect(roster.contacts.find((c) => c.id === contact)).toMatchObject({
      unsubscribed: true,
      reported: true,
    });
  });
});

describe("token rate limit and access", () => {
  it("limits per IP and per token", async () => {
    restore.push(overrideLimit("token_requests_per_token_per_hour", 2));
    const ip = `198.51.100.${Math.floor(Math.random() * 200)}`;
    const hits = [];
    for (let n = 0; n < 3; n += 1) {
      const { data } = await adminClient().rpc("check_token_rate_limit", {
        p_ip: ip,
        p_token_hash: hash,
      });
      hits.push(data);
    }
    expect(hits).toEqual([true, true, false]);
  });

  it("is not callable by anon or signed-in users", async () => {
    const anon = await anonClient().rpc("token_invitee", {
      p_token_hash: hash,
    });
    expect(anon.error?.code).toBe("42501");
    const user = await owner.client.rpc("token_unsubscribe", {
      p_token_hash: hash,
      p_via: "link",
    });
    expect(user.error?.code).toBe("42501");
    const reports = await owner.client.from("abuse_reports").select("id");
    expect(reports.error?.code).toBe("42501");
  });
});
