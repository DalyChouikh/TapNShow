import { beforeEach, describe, expect, it } from "vitest";
import {
  adminClient,
  anonClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

const hash = (): string =>
  `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");

let owner: TestUser;
let admin: TestUser;
let viewer: TestUser;
let workspace: TestWorkspace;

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  admin = await createTestUser({ fullName: "Admin" });
  viewer = await createTestUser({ fullName: "Viewer" });
  workspace = await createWorkspaceAs(owner, "Debate Club");
  await addMember(workspace.id, admin.id, "admin");
  await addMember(workspace.id, viewer.id, "viewer");
});

async function invite(
  by: TestUser,
  email: string,
  role: "admin" | "viewer" = "viewer",
): Promise<{ id: string; tokenHash: string }> {
  const tokenHash = hash();
  const { data, error } = await by.client.rpc("create_invite", {
    p_workspace: workspace.id,
    p_email: email,
    p_role: role,
    p_token_hash: tokenHash,
  });
  if (error || !data) {
    throw error ?? new Error("no invite id");
  }
  return { id: data, tokenHash };
}

async function previewStatus(
  user: TestUser,
  tokenHash: string,
): Promise<string | undefined> {
  const { data } = await user.client.rpc("invite_preview", {
    p_token_hash: tokenHash,
  });
  return data?.[0]?.status;
}

describe("create_invite", () => {
  it("Admins invite Viewers; only the Owner invites Admins", async () => {
    await invite(admin, "new.viewer@example.test");
    await expectAppError(
      admin.client.rpc("create_invite", {
        p_workspace: workspace.id,
        p_email: "new.admin@example.test",
        p_role: "admin",
        p_token_hash: hash(),
      }),
      "forbidden",
    );
    await invite(owner, "new.admin@example.test", "admin");
    await expectAppError(
      viewer.client.rpc("create_invite", {
        p_workspace: workspace.id,
        p_email: "x@example.test",
        p_role: "viewer",
        p_token_hash: hash(),
      }),
      "forbidden",
    );
  });

  it("normalizes the email and keeps one open invite per address", async () => {
    const first = await invite(admin, "  Ali.Ben@Example.TEST ");
    const second = await invite(admin, "ali.ben@example.test");
    const { data } = await admin.client
      .from("workspace_invites")
      .select("id, email, revoked_at")
      .eq("workspace_id", workspace.id);
    expect(data?.find((row) => row.id === first.id)?.revoked_at).not.toBeNull();
    expect(data?.find((row) => row.id === second.id)).toMatchObject({
      email: "ali.ben@example.test",
      revoked_at: null,
    });
  });

  it("refuses existing members and malformed emails", async () => {
    await expectAppError(
      admin.client.rpc("create_invite", {
        p_workspace: workspace.id,
        p_email: viewer.email.toUpperCase(),
        p_role: "viewer",
        p_token_hash: hash(),
      }),
      "already_member",
    );
    await expectAppError(
      admin.client.rpc("create_invite", {
        p_workspace: workspace.id,
        p_email: "not-an-email",
        p_role: "viewer",
        p_token_hash: hash(),
      }),
      "invalid_input",
    );
  });

  it("an Admin cannot replace the Owner's pending Admin invite", async () => {
    await invite(owner, "future.admin@example.test", "admin");
    await expectAppError(
      admin.client.rpc("create_invite", {
        p_workspace: workspace.id,
        p_email: "future.admin@example.test",
        p_role: "viewer",
        p_token_hash: hash(),
      }),
      "forbidden",
    );
  });
});

describe("invite visibility", () => {
  it("Owners and Admins list invites, Viewers do not, and nobody reads token hashes", async () => {
    await invite(admin, "someone@example.test");
    expect(
      (
        await admin.client
          .from("workspace_invites")
          .select("id")
          .eq("workspace_id", workspace.id)
      ).data,
    ).toHaveLength(1);
    expect(
      (
        await viewer.client
          .from("workspace_invites")
          .select("id")
          .eq("workspace_id", workspace.id)
      ).data,
    ).toEqual([]);
    expect(
      (await owner.client.from("workspace_invites").select("token_hash")).error
        ?.code,
    ).toBe("42501");
  });
});

describe("invite_preview and accept_invite", () => {
  it("accepts with the invited verified email, whatever its case", async () => {
    const invitee = await createTestUser({
      email: `ali.${crypto.randomUUID().slice(0, 6)}@example.test`,
    });
    const sent = await invite(admin, `  ${invitee.email.toUpperCase()} `);
    expect(await previewStatus(invitee, sent.tokenHash)).toBe("ready");
    const { data: slug, error } = await invitee.client.rpc("accept_invite", {
      p_token_hash: sent.tokenHash,
    });
    expect(error).toBeNull();
    expect(slug).toBe(workspace.slug);
    const role = await invitee.client
      .from("workspace_roles")
      .select("role")
      .eq("workspace_id", workspace.id)
      .eq("user_id", invitee.id)
      .single();
    expect(role.data?.role).toBe("viewer");
    expect(await previewStatus(invitee, sent.tokenHash)).toBe("already_member");
  });

  it("shows a masked email to the wrong account and refuses to accept", async () => {
    const sent = await invite(admin, "amira@example.test");
    const other = await createTestUser();
    const { data } = await other.client.rpc("invite_preview", {
      p_token_hash: sent.tokenHash,
    });
    expect(data?.[0]).toMatchObject({
      status: "wrong_account",
      workspace_name: "Debate Club",
      masked_email: "a•••@example.test",
    });
    await expectAppError(
      other.client.rpc("accept_invite", { p_token_hash: sent.tokenHash }),
      "invite_wrong_account",
    );
  });

  it("reports revoked, expired, used and unknown tokens", async () => {
    const invitee = await createTestUser();
    const revoked = await invite(admin, invitee.email);
    await admin.client.rpc("revoke_invite", { p_invite: revoked.id });
    expect(await previewStatus(invitee, revoked.tokenHash)).toBe("revoked");

    const expired = await invite(admin, invitee.email);
    await adminClient()
      .from("workspace_invites")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", expired.id);
    expect(await previewStatus(invitee, expired.tokenHash)).toBe("expired");
    await expectAppError(
      invitee.client.rpc("accept_invite", { p_token_hash: expired.tokenHash }),
      "invite_expired",
    );

    expect(await previewStatus(invitee, hash())).toBe("not_found");
  });

  it("marks an accepted invite as used for everyone else", async () => {
    const invitee = await createTestUser();
    const sent = await invite(admin, invitee.email);
    await invitee.client.rpc("accept_invite", { p_token_hash: sent.tokenHash });
    const other = await createTestUser();
    expect(await previewStatus(other, sent.tokenHash)).toBe("used");
  });

  it("requires sign-in", async () => {
    expect(
      (await anonClient().rpc("invite_preview", { p_token_hash: hash() })).error
        ?.code,
    ).toBe("42501");
  });
});

describe("renew_invite", () => {
  it("replaces the token and keeps one row", async () => {
    const invitee = await createTestUser();
    const sent = await invite(admin, invitee.email);
    const fresh = hash();
    expect(
      (
        await admin.client.rpc("renew_invite", {
          p_invite: sent.id,
          p_token_hash: fresh,
        })
      ).error,
    ).toBeNull();
    expect(await previewStatus(invitee, sent.tokenHash)).toBe("not_found");
    expect(await previewStatus(invitee, fresh)).toBe("ready");
  });

  it("refuses closed invites", async () => {
    const sent = await invite(admin, "closed@example.test");
    await admin.client.rpc("revoke_invite", { p_invite: sent.id });
    await expectAppError(
      admin.client.rpc("renew_invite", {
        p_invite: sent.id,
        p_token_hash: hash(),
      }),
      "invite_closed",
    );
  });
});

describe("consume_invite_email", () => {
  it("allows 20 invite emails per workspace per 24 hours, for Owners/Admins only", async () => {
    const results: boolean[] = [];
    for (let index = 0; index < 21; index += 1) {
      const { data } = await admin.client.rpc("consume_invite_email", {
        p_workspace: workspace.id,
      });
      results.push(data === true);
    }
    expect(results.slice(0, 20).every(Boolean)).toBe(true);
    expect(results[20]).toBe(false);
    await expectAppError(
      viewer.client.rpc("consume_invite_email", { p_workspace: workspace.id }),
      "forbidden",
    );
  });
});
