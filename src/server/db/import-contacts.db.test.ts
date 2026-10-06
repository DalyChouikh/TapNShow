import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { emailSchema } from "@/shared/api/common";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { seedContacts, seedList } from "@/test/db/roster";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

const resultSchema = z.object({
  summary: z.object({
    new: z.number(),
    updated: z.number(),
    unchanged: z.number(),
    invalid: z.number(),
    merged: z.number(),
  }),
  new_lists: z.array(z.string()),
  limit_exceeded: z.enum(["contacts", "lists"]).nullable(),
  rows: z.array(
    z.object({
      row: z.number(),
      email: z.string(),
      full_name: z.string().nullable(),
      outcome: z.enum(["new", "updated", "unchanged", "invalid"]),
      reason: z.string().nullable(),
      added_lists: z.array(z.string()),
      previous_name: z.string().nullable(),
      merged_rows: z.array(z.number()),
    }),
  ),
});
type ImportResult = z.infer<typeof resultSchema>;
type Row = {
  row?: number;
  full_name?: string | null;
  email?: string | null;
  lists?: string[];
};

let owner: TestUser;
let viewer: TestUser;
let workspace: TestWorkspace;

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  viewer = await createTestUser({ fullName: "Viewer" });
  workspace = await createWorkspaceAs(owner, "Import Club");
  await addMember(workspace.id, viewer.id, "viewer");
});

async function run(
  rows: Row[],
  dryRun: boolean,
  alsoAddToList?: string,
  user = owner,
): Promise<ImportResult> {
  const { data, error } = await user.client.rpc("import_contacts", {
    p_workspace: workspace.id,
    p_rows: rows,
    p_dry_run: dryRun,
    p_also_add_to_list: alsoAddToList,
  });
  if (error) {
    throw new Error(error.message);
  }
  return resultSchema.parse(data);
}

async function counts(): Promise<{
  contacts: number;
  lists: number;
  links: number;
}> {
  const admin = adminClient();
  const head = { count: "exact" as const, head: true };
  const [contacts, lists, links] = await Promise.all([
    admin.from("contacts").select("id", head).eq("workspace_id", workspace.id),
    admin.from("lists").select("id", head).eq("workspace_id", workspace.id),
    admin
      .from("list_contacts")
      .select("list_id", head)
      .eq("workspace_id", workspace.id),
  ]);
  return {
    contacts: contacts.count ?? -1,
    lists: lists.count ?? -1,
    links: links.count ?? -1,
  };
}

async function rosterOf(): Promise<
  Array<{ email: string; full_name: string; lists: string[] }>
> {
  const { data } = await adminClient()
    .from("contacts")
    .select("email, full_name, list_contacts(lists(name))")
    .eq("workspace_id", workspace.id)
    .order("email");
  return (data ?? []).map((contact) => ({
    email: contact.email,
    full_name: contact.full_name,
    lists: contact.list_contacts.map((link) => link.lists?.name ?? "").sort(),
  }));
}

const ROSTER: Row[] = [
  {
    row: 2,
    full_name: "Inès  Ben Salah",
    email: " Ines@Example.com ",
    lists: ["Dev", "Events"],
  },
  { row: 3, full_name: "Youssef", email: "y@example.com", lists: ["design"] },
  { row: 4, full_name: "", email: "nobody@example.com", lists: [] },
  { row: 5, full_name: "Bad", email: "mehdi.g@gmail", lists: [] },
  {
    row: 6,
    full_name: "Inès B.",
    email: "ines@example.com",
    lists: ["dev", "Media"],
  },
  { row: 7, full_name: "Sarra", email: "", lists: [] },
];

async function seedYoussef(): Promise<void> {
  const design = await seedList(workspace.id, "Design");
  const { data } = await adminClient()
    .from("contacts")
    .insert({
      workspace_id: workspace.id,
      email: "y@example.com",
      full_name: "Youssef T.",
    })
    .select("id")
    .single();
  await adminClient()
    .from("list_contacts")
    .insert({
      workspace_id: workspace.id,
      list_id: design,
      contact_id: data?.id ?? "",
    });
}

describe("import_contacts dry run", () => {
  it("classifies, merges and resolves lists without writing anything", async () => {
    await seedYoussef();
    const before = await counts();
    const result = await run(ROSTER, true);
    expect(await counts()).toEqual(before);
    expect(result.summary).toEqual({
      new: 1,
      updated: 1,
      unchanged: 0,
      invalid: 3,
      merged: 1,
    });
    expect(result.new_lists).toEqual(["Dev", "Events", "Media"]);
    expect(result.limit_exceeded).toBeNull();
    expect(result.rows).toEqual([
      {
        row: 2,
        email: "ines@example.com",
        full_name: "Inès B.",
        outcome: "new",
        reason: null,
        added_lists: ["Dev", "Events", "Media"],
        previous_name: null,
        merged_rows: [6],
      },
      {
        row: 3,
        email: "y@example.com",
        full_name: "Youssef",
        outcome: "updated",
        reason: null,
        added_lists: [],
        previous_name: "Youssef T.",
        merged_rows: [],
      },
      {
        row: 4,
        email: "nobody@example.com",
        full_name: null,
        outcome: "invalid",
        reason: "name_missing",
        added_lists: [],
        previous_name: null,
        merged_rows: [],
      },
      {
        row: 5,
        email: "mehdi.g@gmail",
        full_name: "Bad",
        outcome: "invalid",
        reason: "email_invalid",
        added_lists: [],
        previous_name: null,
        merged_rows: [],
      },
      {
        row: 7,
        email: "",
        full_name: "Sarra",
        outcome: "invalid",
        reason: "email_missing",
        added_lists: [],
        previous_name: null,
        merged_rows: [],
      },
    ]);
  });

  it("agrees with emailSchema on which addresses are valid", async () => {
    const samples = [
      "o'brien@example.com",
      "first.last+tag@sub.example.tn",
      "a..b@example.com",
      ".a@example.com",
      "ines@example.c",
      "ines@example",
      "ines@-example.com",
      "ines@exa_mple.com",
      "inès@example.com",
      "a@b.co",
      "UPPER@EXAMPLE.COM",
    ];
    const result = await run(
      samples.map((email, i) => ({ row: i + 1, full_name: "X", email })),
      true,
    );
    for (const [i, email] of samples.entries()) {
      const outcome = result.rows.find((row) => row.row === i + 1)?.outcome;
      expect({ email, valid: outcome !== "invalid" }).toEqual({
        email,
        valid: emailSchema.safeParse(email).success,
      });
    }
  });

  it("reports names and list names that are too long", async () => {
    const result = await run(
      [
        { row: 1, full_name: "x".repeat(121), email: "long@example.com" },
        {
          row: 2,
          full_name: "Ok",
          email: "ok@example.com",
          lists: ["y".repeat(61)],
        },
      ],
      true,
    );
    expect(result.rows.map((row) => row.reason)).toEqual([
      "name_too_long",
      "list_name_too_long",
    ]);
  });

  it("flags a contact cap that the import would exceed", async () => {
    await seedContacts(workspace.id, 1999, "fill");
    const result = await run(
      [
        { row: 1, full_name: "A", email: "a@example.com" },
        { row: 2, full_name: "B", email: "b@example.com" },
      ],
      true,
    );
    expect(result.limit_exceeded).toBe("contacts");
    await expectAppError(
      owner.client.rpc("import_contacts", {
        p_workspace: workspace.id,
        p_rows: [
          { row: 1, full_name: "A", email: "a@example.com" },
          { row: 2, full_name: "B", email: "b@example.com" },
        ],
        p_dry_run: false,
      }),
      "contacts_limit_reached",
    );
  });

  it("flags a list cap that the import would exceed", async () => {
    for (let n = 1; n <= 49; n += 1) {
      await seedList(workspace.id, `List ${n}`);
    }
    const result = await run(
      [
        {
          row: 1,
          full_name: "A",
          email: "a@example.com",
          lists: ["New 1", "New 2"],
        },
      ],
      true,
    );
    expect(result.limit_exceeded).toBe("lists");
  });
});

describe("import_contacts commit", () => {
  it("applies exactly what the dry run showed", async () => {
    await seedYoussef();
    const preview = await run(ROSTER, true);
    const committed = await run(ROSTER, false);
    expect(committed).toEqual(preview);
    expect(await rosterOf()).toEqual([
      {
        email: "ines@example.com",
        full_name: "Inès B.",
        lists: ["Dev", "Events", "Media"],
      },
      { email: "y@example.com", full_name: "Youssef", lists: ["Design"] },
    ]);
  });

  it("re-importing the same rows reports 0 new and creates nothing (Review Focus 4)", async () => {
    await run(ROSTER, false);
    const before = await counts();
    const again = await run(
      ROSTER.map((row) => ({
        ...row,
        email: row.email?.toUpperCase(),
        lists: row.lists?.map((name) => name.toLowerCase()),
      })),
      false,
    );
    expect(again.summary.new).toBe(0);
    expect(again.new_lists).toEqual([]);
    expect(await counts()).toEqual(before);
  });

  it("updates names and adds lists, never removes a list", async () => {
    await seedYoussef();
    await run(
      [
        {
          row: 1,
          full_name: "Youssef Trabelsi",
          email: "y@example.com",
          lists: ["Media"],
        },
      ],
      false,
    );
    expect(await rosterOf()).toEqual([
      {
        email: "y@example.com",
        full_name: "Youssef Trabelsi",
        lists: ["Design", "Media"],
      },
    ]);
  });

  it("keeps the stored name when the file's name is empty", async () => {
    await seedYoussef();
    const result = await run(
      [{ row: 1, full_name: "  ", email: "y@example.com", lists: ["Design"] }],
      false,
    );
    expect(result.rows[0]).toMatchObject({
      outcome: "unchanged",
      full_name: "Youssef T.",
    });
  });

  it("adds everyone to the chosen list and refuses a list of another workspace", async () => {
    const alumni = await seedList(workspace.id, "Alumni");
    await run(
      [
        { row: 1, full_name: "A", email: "a@example.com", lists: ["alumni"] },
        { row: 2, full_name: "B", email: "b@example.com" },
      ],
      false,
      alumni,
    );
    expect((await rosterOf()).map((contact) => contact.lists)).toEqual([
      ["Alumni"],
      ["Alumni"],
    ]);
    const other = await createWorkspaceAs(owner, "Other Club");
    const foreign = await seedList(other.id, "Foreign");
    await expectAppError(
      owner.client.rpc("import_contacts", {
        p_workspace: workspace.id,
        p_rows: [],
        p_dry_run: true,
        p_also_add_to_list: foreign,
      }),
      "not_found",
    );
  });
});

describe("import_contacts guards", () => {
  it("refuses Viewers and non-members", async () => {
    const outsider = await createTestUser();
    for (const user of [viewer, outsider]) {
      await expectAppError(
        user.client.rpc("import_contacts", {
          p_workspace: workspace.id,
          p_rows: [],
          p_dry_run: true,
        }),
        "forbidden",
      );
    }
  });

  it("refuses more rows than import_rows_max", async () => {
    const rows = Array.from({ length: 2001 }, (_, i) => ({
      row: i + 1,
      full_name: "X",
      email: `x${i}@example.com`,
    }));
    await expectAppError(
      owner.client.rpc("import_contacts", {
        p_workspace: workspace.id,
        p_rows: rows,
        p_dry_run: true,
      }),
      "import_too_many_rows",
    );
  });

  it("limits commits to 30 per hour, separately from previews", async () => {
    for (let n = 0; n < 30; n += 1) {
      await run(
        [{ row: 1, full_name: "Same", email: "same@example.com" }],
        false,
      );
    }
    await expectAppError(
      owner.client.rpc("import_contacts", {
        p_workspace: workspace.id,
        p_rows: [],
        p_dry_run: false,
      }),
      "rate_limited",
    );
    await expect(run([], true)).resolves.toMatchObject({ summary: { new: 0 } });
  });
});
