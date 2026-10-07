import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { seedConnection, setSender } from "@/test/db/sender";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

const GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
const senderSchema = z.object({
  sender: z
    .object({
      connection_id: z.uuid(),
      email: z.string(),
      status: z.enum(["active", "broken"]),
      connected_by: z.string(),
      connected_at: z.string(),
      is_mine: z.boolean(),
      sent_last_24h: z.number(),
      daily_limit: z.number(),
    })
    .nullable(),
  owner_name: z.string(),
  my_connections: z.array(
    z.object({
      id: z.uuid(),
      email: z.string(),
      status: z.enum(["active", "broken"]),
      used_by: z.array(z.string()),
    }),
  ),
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
  workspace = await createWorkspaceAs(owner, "Sender Club");
  await addMember(workspace.id, admin.id, "admin");
  await addMember(workspace.id, viewer.id, "viewer");
});

describe("google_connections", () => {
  it("is saved only by the server, for the verified user, once per Google account", async () => {
    const save = (token: string) =>
      adminClient().rpc("save_google_connection", {
        p_user: owner.id,
        p_google_sub: "sub-1",
        p_google_email: " Club@Gmail.com ",
        p_scopes: ["openid", "email", GMAIL_SEND],
        p_token_encrypted: token,
      });
    const first = await save("v1.a.b.c");
    expect(first.error).toBeNull();
    await adminClient()
      .from("google_connections")
      .update({ status: "broken", broken_reason: "invalid_grant" })
      .eq("id", first.data ?? "");
    const second = await save("v1.d.e.f");
    expect(second.data).toBe(first.data);
    const row = await owner.client
      .from("google_connections")
      .select("google_email, status, broken_reason, user_id")
      .eq("id", first.data ?? "")
      .single();
    expect(row.data).toEqual({
      google_email: "club@gmail.com",
      status: "active",
      broken_reason: null,
      user_id: owner.id,
    });
  });

  it("refuses signed-in callers, so no one can claim another Google account", async () => {
    const forged = await owner.client.rpc("save_google_connection", {
      p_user: owner.id,
      p_google_sub: "someone-elses-sub",
      p_google_email: "president@example.test",
      p_scopes: ["openid", "email", GMAIL_SEND],
      p_token_encrypted: "v1.a.b.c",
    });
    expect(forged.error?.code).toBe("42501");
  });

  it("refuses a connection without gmail.send", async () => {
    await expectAppError(
      adminClient().rpc("save_google_connection", {
        p_user: owner.id,
        p_google_sub: "sub-2",
        p_google_email: "club@gmail.com",
        p_scopes: ["openid", "email"],
        p_token_encrypted: "v1.a.b.c",
      }),
      "invalid_input",
    );
  });

  it("never exposes the token column and hides other users' rows", async () => {
    const id = await seedConnection(owner.id);
    const token = await owner.client
      .from("google_connections")
      .select("refresh_token_encrypted")
      .eq("id", id);
    expect(token.error?.code).toBe("42501");
    const mine = await owner.client
      .from("google_connections")
      .select("id")
      .eq("id", id);
    expect(mine.data).toEqual([{ id }]);
    const theirs = await outsider.client
      .from("google_connections")
      .select("id")
      .eq("id", id);
    expect(theirs.data).toEqual([]);
    const write = await owner.client
      .from("google_connections")
      .update({ status: "active" })
      .eq("id", id);
    expect(write.error?.code).toBe("42501");
  });
});

describe("set_workspace_sender", () => {
  it("lets only the Owner choose their own active connection", async () => {
    const mine = await seedConnection(owner.id);
    const adminsOwn = await seedConnection(admin.id);
    const broken = await seedConnection(owner.id, { status: "broken" });
    await expectAppError(
      admin.client.rpc("set_workspace_sender", {
        p_workspace: workspace.id,
        p_connection: adminsOwn,
      }),
      "owner_only",
    );
    await expectAppError(
      viewer.client.rpc("set_workspace_sender", {
        p_workspace: workspace.id,
        p_connection: mine,
      }),
      "owner_only",
    );
    await expectAppError(
      outsider.client.rpc("set_workspace_sender", {
        p_workspace: workspace.id,
        p_connection: mine,
      }),
      "forbidden",
    );
    await expectAppError(
      owner.client.rpc("set_workspace_sender", {
        p_workspace: workspace.id,
        p_connection: adminsOwn,
      }),
      "not_found",
    );
    await expectAppError(
      owner.client.rpc("set_workspace_sender", {
        p_workspace: workspace.id,
        p_connection: broken,
      }),
      "not_found",
    );
    const ok = await owner.client.rpc("set_workspace_sender", {
      p_workspace: workspace.id,
      p_connection: mine,
    });
    expect(ok.error).toBeNull();
    const direct = await admin.client
      .from("workspaces")
      .update({ sender_connection_id: null })
      .eq("id", workspace.id);
    expect(direct.error?.code).toBe("42501");
  });
});

describe("disconnect_google_connection", () => {
  it("returns the token, deletes the row and clears every workspace using it", async () => {
    const id = await seedConnection(owner.id, { sub: "sub-disc" });
    await setSender(workspace.id, id);
    await expectAppError(
      admin.client.rpc("disconnect_google_connection", { p_connection: id }),
      "not_found",
    );
    const result = await owner.client.rpc("disconnect_google_connection", {
      p_connection: id,
    });
    expect(result.data).toEqual({
      refresh_token_encrypted: "v1.test.test.test",
      google_sub: "sub-disc",
    });
    const row = await adminClient()
      .from("workspaces")
      .select("sender_connection_id")
      .eq("id", workspace.id)
      .single();
    expect(row.data?.sender_connection_id).toBeNull();
  });
});

describe("workspace_sender", () => {
  it("shows the sender to every member, with usage, and lists only my connections", async () => {
    // send_log outlives test runs (no reset between runs), so the Google account id is unique per run.
    const sub = `sub-club-${crypto.randomUUID()}`;
    const id = await seedConnection(owner.id, {
      email: "club@gmail.com",
      sub,
    });
    await setSender(workspace.id, id);
    // Bulk inserts send null for a key missing from some rows, so every row names sent_at.
    const logged = await adminClient()
      .from("send_log")
      .insert([
        {
          google_sub: sub,
          workspace_id: workspace.id,
          sent_at: new Date().toISOString(),
        },
        {
          google_sub: sub,
          workspace_id: workspace.id,
          sent_at: new Date(Date.now() - 25 * 3600_000).toISOString(),
        },
      ]);
    expect(logged.error).toBeNull();
    const asViewer = senderSchema.parse(
      (
        await viewer.client.rpc("workspace_sender", {
          p_workspace: workspace.id,
        })
      ).data,
    );
    expect(asViewer.sender).toMatchObject({
      email: "club@gmail.com",
      connected_by: "Owner",
      is_mine: false,
      sent_last_24h: 1,
      daily_limit: 400,
    });
    expect(asViewer.owner_name).toBe("Owner");
    expect(asViewer.my_connections).toEqual([]);
    const asOwner = senderSchema.parse(
      (
        await owner.client.rpc("workspace_sender", {
          p_workspace: workspace.id,
        })
      ).data,
    );
    expect(asOwner.sender?.is_mine).toBe(true);
    expect(asOwner.my_connections).toEqual([
      {
        id,
        email: "club@gmail.com",
        status: "active",
        used_by: ["Sender Club"],
      },
    ]);
    await expectAppError(
      outsider.client.rpc("workspace_sender", { p_workspace: workspace.id }),
      "forbidden",
    );
  });
});

describe("meeting defaults", () => {
  it("lets Owner/Admin edit the defaults within limits, not Viewers", async () => {
    const ok = await admin.client
      .from("workspaces")
      .update({
        default_response_mode: "rsvp",
        default_delay_options: [10, 20],
        default_reason_required: false,
        default_comments_enabled: true,
        default_footer_note: "Bring your laptop",
        default_duration_minutes: 90,
      })
      .eq("id", workspace.id)
      .select("default_response_mode, default_delay_options")
      .single();
    expect(ok.data).toEqual({
      default_response_mode: "rsvp",
      default_delay_options: [10, 20],
    });
    for (const bad of [[0], [5, 5], [1, 2, 3, 4, 5, 6, 7], [241]]) {
      const rejected = await admin.client
        .from("workspaces")
        .update({ default_delay_options: bad })
        .eq("id", workspace.id);
      expect(rejected.error?.code).toBe("23514");
    }
    await viewer.client
      .from("workspaces")
      .update({ default_duration_minutes: 30 })
      .eq("id", workspace.id);
    const after = await adminClient()
      .from("workspaces")
      .select("default_duration_minutes")
      .eq("id", workspace.id)
      .single();
    expect(after.data?.default_duration_minutes).toBe(90);
  });

  it("starts new workspaces with the documented defaults", async () => {
    const row = await adminClient()
      .from("workspaces")
      .select(
        "default_response_mode, default_delay_options, default_reason_required, default_comments_enabled, default_footer_note, default_duration_minutes, sender_connection_id",
      )
      .eq("id", workspace.id)
      .single();
    expect(row.data).toEqual({
      default_response_mode: "attendance",
      default_delay_options: [5, 10, 15, 30],
      default_reason_required: true,
      default_comments_enabled: false,
      default_footer_note: "",
      default_duration_minutes: 60,
      sender_connection_id: null,
    });
  });
});
