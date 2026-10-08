import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { seedInvitee } from "@/test/db/invitees";
import { seedMeeting } from "@/test/db/meetings";
import { seedContacts } from "@/test/db/roster";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

let owner: TestUser;
let workspace: TestWorkspace;

const pageSchema = z.object({
  has_more: z.boolean(),
  items: z.array(
    z
      .object({
        id: z.uuid(),
        title: z.string(),
        sort_key: z.string().nullable(),
        counts: z.object({
          invited: z.number(),
          sent: z.number(),
          queued: z.number(),
          attending: z.number(),
          late: z.number(),
          absent: z.number(),
          no_reply: z.number(),
        }),
      })
      .loose(),
  ),
});

const at = (hours: number) =>
  new Date(Date.now() + hours * 3600_000).toISOString();

async function page(
  tab: string,
  after: { key: string | null; id: string } | null = null,
  limit = 50,
  as = owner,
) {
  const { data, error } = await as.client.rpc("meetings_page", {
    p_workspace: workspace.id,
    p_tab: tab,
    p_after_key: after?.key ?? null,
    p_after_id: after?.id ?? null,
    p_limit: limit,
  } as never);
  if (error) {
    throw error;
  }
  return pageSchema.parse(data);
}

beforeEach(async () => {
  owner = await createTestUser();
  workspace = await createWorkspaceAs(owner, "Paging Club");
});

describe("meetings_page", () => {
  it("splits upcoming, past and drafts like the old tabs", async () => {
    const soon = await seedMeeting(workspace.id, {
      status: "scheduled",
      title: "Soon",
      starts_at: at(2),
    });
    const running = await seedMeeting(workspace.id, {
      status: "scheduled",
      title: "Running",
      starts_at: at(-0.5),
    });
    const done = await seedMeeting(workspace.id, {
      status: "scheduled",
      title: "Done",
      starts_at: at(-48),
    });
    const draft = await seedMeeting(workspace.id, {
      status: "draft",
      title: "Draft",
    });
    await seedMeeting(workspace.id, {
      status: "draft",
      title: "",
      starts_at: null,
    });
    expect((await page("upcoming")).items.map((m) => m.id)).toEqual([
      running,
      soon,
    ]);
    expect((await page("past")).items.map((m) => m.id)).toEqual([done]);
    expect((await page("drafts")).items.map((m) => m.id)).toEqual([draft]);
  });

  it("pages by keyset with equal start times and a row inserted between pages (Review Focus 5)", async () => {
    const same = at(5);
    const ids: string[] = [];
    for (let n = 0; n < 5; n += 1) {
      ids.push(
        await seedMeeting(workspace.id, {
          status: "scheduled",
          title: `M${n}`,
          starts_at: same,
        }),
      );
    }
    const first = await page("upcoming", null, 2);
    expect(first.items).toHaveLength(2);
    expect(first.has_more).toBe(true);
    await seedMeeting(workspace.id, {
      status: "scheduled",
      title: "Earlier",
      starts_at: at(1),
    });
    const last = first.items[1];
    const second = await page(
      "upcoming",
      { key: last.sort_key, id: last.id },
      10,
    );
    const seen = [...first.items, ...second.items].map((m) => m.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.filter((id) => ids.includes(id)).sort()).toEqual(
      [...ids].sort(),
    );
  });

  it("counts invites and answers per meeting", async () => {
    const meeting = await seedMeeting(workspace.id, {
      status: "scheduled",
      starts_at: at(3),
    });
    const contacts = await seedContacts(
      workspace.id,
      4,
      `pg-${crypto.randomUUID().slice(0, 6)}`,
    );
    const hashes = [];
    for (const contact of contacts) {
      hashes.push((await seedInvitee(workspace.id, meeting, contact)).hash);
    }
    await adminClient().rpc("token_submit_response", {
      p_token_hash: hashes[0],
      p_status: "attending",
      p_delay_minutes: null,
      p_reason: null,
      p_comment: null,
    } as never);
    await adminClient().rpc("token_submit_response", {
      p_token_hash: hashes[1],
      p_status: "late",
      p_delay_minutes: 10,
      p_reason: "Bus",
      p_comment: null,
    } as never);
    await adminClient().rpc("token_submit_response", {
      p_token_hash: hashes[2],
      p_status: "absent",
      p_delay_minutes: null,
      p_reason: "Sick",
      p_comment: null,
    } as never);
    const [item] = (await page("upcoming")).items;
    expect(item.counts).toEqual({
      invited: 4,
      sent: 4,
      queued: 0,
      attending: 1,
      late: 1,
      absent: 1,
      no_reply: 1,
    });
  });

  it("is for members only and checks its arguments", async () => {
    const outsider = await createTestUser();
    await expectAppError(
      outsider.client.rpc("meetings_page", {
        p_workspace: workspace.id,
        p_tab: "upcoming",
        p_after_key: null,
        p_after_id: null,
        p_limit: 10,
      } as never),
      "forbidden",
    );
    await expectAppError(
      owner.client.rpc("meetings_page", {
        p_workspace: workspace.id,
        p_tab: "all",
        p_after_key: null,
        p_after_id: null,
        p_limit: 10,
      } as never),
      "invalid_input",
    );
    const viewer = await createTestUser();
    await addMember(workspace.id, viewer.id, "viewer");
    expect((await page("upcoming", null, 10, viewer)).items).toEqual([]);
  });
});
