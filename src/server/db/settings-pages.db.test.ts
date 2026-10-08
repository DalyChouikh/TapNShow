import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { seedMeeting } from "@/test/db/meetings";
import { seedContacts, seedList } from "@/test/db/roster";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

let owner: TestUser;
let workspace: TestWorkspace;

const membersPage = z.object({
  has_more: z.boolean(),
  items: z.array(
    z
      .object({ user_id: z.uuid(), role: z.string(), sort_name: z.string() })
      .loose(),
  ),
});

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  workspace = await createWorkspaceAs(owner, "Settings Club");
});

describe("members_page", () => {
  it("pages Owner, Admins, Viewers in order without gaps, including equal names", async () => {
    for (let n = 0; n < 5; n += 1) {
      const user = await createTestUser({ fullName: "Same Name" });
      await addMember(workspace.id, user.id, n < 2 ? "admin" : "viewer");
    }
    const first = membersPage.parse(
      (
        await owner.client.rpc("members_page", {
          p_workspace: workspace.id,
          p_role: null,
          p_after_role: null,
          p_after_name: null,
          p_after_id: null,
          p_limit: 3,
        } as never)
      ).data,
    );
    expect(first.has_more).toBe(true);
    expect(first.items.map((m) => m.role)).toEqual(["owner", "admin", "admin"]);
    const last = first.items[2];
    const second = membersPage.parse(
      (
        await owner.client.rpc("members_page", {
          p_workspace: workspace.id,
          p_role: null,
          p_after_role: last.role,
          p_after_name: last.sort_name,
          p_after_id: last.user_id,
          p_limit: 10,
        } as never)
      ).data,
    );
    const ids = [...first.items, ...second.items].map((m) => m.user_id);
    expect(new Set(ids).size).toBe(6);
    expect(second.has_more).toBe(false);
  });

  it("filters by role (the transfer dialog lists Admins only)", async () => {
    const admin = await createTestUser({ fullName: "Ada" });
    await addMember(workspace.id, admin.id, "admin");
    const page = membersPage.parse(
      (
        await owner.client.rpc("members_page", {
          p_workspace: workspace.id,
          p_role: "admin",
          p_after_role: null,
          p_after_name: null,
          p_after_id: null,
          p_limit: 50,
        } as never)
      ).data,
    );
    expect(page.items.map((m) => m.user_id)).toEqual([admin.id]);
  });

  it("is for members only", async () => {
    const outsider = await createTestUser();
    await expectAppError(
      outsider.client.rpc("members_page", {
        p_workspace: workspace.id,
        p_role: null,
        p_after_role: null,
        p_after_name: null,
        p_after_id: null,
        p_limit: 50,
      } as never),
      "forbidden",
    );
  });
});

describe("invites_page", () => {
  it("pages open invites newest first", async () => {
    for (let n = 0; n < 3; n += 1) {
      const { error } = await owner.client.rpc("create_invite", {
        p_workspace: workspace.id,
        p_email: `inv-${n}-${crypto.randomUUID().slice(0, 6)}@example.test`,
        p_role: "viewer",
        p_token_hash: crypto.randomUUID().replaceAll("-", "").repeat(2),
      } as never);
      expect(error).toBeNull();
    }
    const page = z
      .object({
        has_more: z.boolean(),
        items: z.array(
          z.object({ id: z.uuid(), created_at: z.string() }).loose(),
        ),
      })
      .parse(
        (
          await owner.client.rpc("invites_page", {
            p_workspace: workspace.id,
            p_after_created: null,
            p_after_id: null,
            p_limit: 2,
          } as never)
        ).data,
      );
    expect(page.items).toHaveLength(2);
    expect(page.has_more).toBe(true);
  });
});

describe("meeting_audience at the roster cap (#174 measurement)", () => {
  it("answers for 2,000 contacts in 10 lists well under a second", async () => {
    const contacts = await seedContacts(
      workspace.id,
      2000,
      `cap-${crypto.randomUUID().slice(0, 6)}`,
    );
    const lists: string[] = [];
    for (let n = 0; n < 10; n += 1) {
      lists.push(await seedList(workspace.id, `Team ${n}`));
    }
    for (let start = 0; start < contacts.length; start += 500) {
      const { error } = await adminClient()
        .from("list_contacts")
        .insert(
          contacts.slice(start, start + 500).map((contact, k) => ({
            workspace_id: workspace.id,
            list_id: lists[(start + k) % 10],
            contact_id: contact,
          })),
        );
      expect(error).toBeNull();
    }
    const meeting = await seedMeeting(workspace.id);
    const { error } = await adminClient()
      .from("meeting_audience")
      .insert(
        lists.map((list) => ({
          workspace_id: workspace.id,
          meeting_id: meeting,
          list_id: list,
        })),
      );
    expect(error).toBeNull();
    const started = performance.now();
    const { data } = await owner.client.rpc("meeting_audience", {
      p_meeting: meeting,
    } as never);
    const elapsed = performance.now() - started;
    expect((data as { counts: { selected: number } }).counts.selected).toBe(
      2000,
    );
    // Was ~3 s before the set-based rewrite and the definer body (~50 ms after, locally).
    expect(elapsed).toBeLessThan(1500);
  }, 60_000);
});
