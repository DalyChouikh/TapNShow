import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminClient,
  anonClient,
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
  workspace = await createWorkspaceAs(owner, "Roster Club");
  await addMember(workspace.id, admin.id, "admin");
  await addMember(workspace.id, viewer.id, "viewer");
});

describe("contacts and lists RLS", () => {
  it("lets Owner/Admin write, Viewers read, and hides everything from others", async () => {
    const created = await admin.client
      .from("contacts")
      .insert({
        workspace_id: workspace.id,
        email: "amira@example.test",
        full_name: "Amira",
      })
      .select("id")
      .single();
    expect(created.error).toBeNull();
    const id = created.data?.id ?? "";

    const asViewer = await viewer.client
      .from("contacts")
      .select("id, email")
      .eq("workspace_id", workspace.id);
    expect(asViewer.data).toEqual([{ id, email: "amira@example.test" }]);
    const viewerInsert = await viewer.client.from("contacts").insert({
      workspace_id: workspace.id,
      email: "v@example.test",
      full_name: "V",
    });
    expect(viewerInsert.error?.code).toBe("42501");
    const viewerUpdate = await viewer.client
      .from("contacts")
      .update({ full_name: "X" })
      .eq("id", id)
      .select("id");
    expect(viewerUpdate.data).toEqual([]);

    expect(
      (
        await outsider.client
          .from("contacts")
          .select("id")
          .eq("workspace_id", workspace.id)
      ).data,
    ).toEqual([]);
    expect((await anonClient().from("contacts").select("id")).error?.code).toBe(
      "42501",
    );

    const renamed = await owner.client
      .from("contacts")
      .update({ full_name: "Amira B." })
      .eq("id", id)
      .select("full_name");
    expect(renamed.data).toEqual([{ full_name: "Amira B." }]);
  });

  it("stores emails normalized and rejects malformed ones", async () => {
    const bad = await admin.client.from("contacts").insert({
      workspace_id: workspace.id,
      email: "Not An Email",
      full_name: "Bad",
    });
    expect(bad.error?.code).toBe("23514");
    const upper = await admin.client.from("contacts").insert({
      workspace_id: workspace.id,
      email: "Amira@Example.test",
      full_name: "Amira",
    });
    expect(upper.error?.code).toBe("23514");
  });

  it("refuses a second contact with the same email and a list name differing only in case", async () => {
    await seedContacts(workspace.id, 1, "dup");
    const again = await admin.client.from("contacts").insert({
      workspace_id: workspace.id,
      email: "dup-1@example.test",
      full_name: "Again",
    });
    expect(again.error?.code).toBe("23505");
    await seedList(workspace.id, "Dev");
    const dev = await admin.client
      .from("lists")
      .insert({ workspace_id: workspace.id, name: "dev" });
    expect(dev.error?.code).toBe("23505");
  });

  it("cannot link a contact to a list of another workspace", async () => {
    const other = await createWorkspaceAs(admin, "Other Club");
    const [contact] = await seedContacts(workspace.id, 1, "x");
    const foreignList = await seedList(other.id, "Foreign");
    const linked = await admin.client.from("list_contacts").insert({
      workspace_id: workspace.id,
      list_id: foreignList,
      contact_id: contact,
    });
    expect(linked.error?.code).toBe("23503");
  });

  it("removes memberships when a list or a contact is deleted, never the people", async () => {
    const [a, b] = await seedContacts(workspace.id, 2, "keep");
    const list = await seedList(workspace.id, "Design");
    await admin.client.from("list_contacts").insert([
      { workspace_id: workspace.id, list_id: list, contact_id: a },
      { workspace_id: workspace.id, list_id: list, contact_id: b },
    ]);
    await admin.client.from("contacts").delete().eq("id", a);
    await admin.client.from("lists").delete().eq("id", list);
    const left = await adminClient()
      .from("contacts")
      .select("id")
      .eq("workspace_id", workspace.id);
    expect(left.data).toEqual([{ id: b }]);
    const links = await adminClient()
      .from("list_contacts")
      .select("contact_id")
      .eq("workspace_id", workspace.id);
    expect(links.data).toEqual([]);
  });
});

describe("caps", () => {
  it("allows 50 lists and refuses the 51st", async () => {
    for (let n = 1; n <= 50; n += 1) {
      await seedList(workspace.id, `List ${n}`);
    }
    await expectAppError(
      admin.client
        .from("lists")
        .insert({ workspace_id: workspace.id, name: "One too many" }),
      "lists_limit_reached",
    );
  });

  it("allows 2,000 contacts and refuses the 2,001st, also under two concurrent inserts", async () => {
    await seedContacts(workspace.id, 1996, "fill");
    const insertTwo = (prefix: string) =>
      admin.client.from("contacts").insert([
        {
          workspace_id: workspace.id,
          email: `${prefix}-a@example.test`,
          full_name: "A",
        },
        {
          workspace_id: workspace.id,
          email: `${prefix}-b@example.test`,
          full_name: "B",
        },
        {
          workspace_id: workspace.id,
          email: `${prefix}-c@example.test`,
          full_name: "C",
        },
      ]);
    const [first, second] = await Promise.all([insertTwo("p"), insertTwo("q")]);
    const messages = [first.error?.message, second.error?.message];
    expect(
      messages.filter((message) => message === "tn:contacts_limit_reached"),
    ).toHaveLength(1);
    const { count } = await adminClient()
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id);
    expect(count).toBe(1999);
  });
});

describe("roster()", () => {
  it("returns every contact even past the Data API's 1,000-row cap (Review Focus 1)", async () => {
    await seedContacts(workspace.id, 1100, "big");
    const { data, error } = await viewer.client.rpc("roster", {
      p_workspace: workspace.id,
    });
    expect(error).toBeNull();
    const roster = z
      .object({ contacts: z.array(z.object({ id: z.uuid() })) })
      .parse(data);
    expect(roster.contacts).toHaveLength(1100);
  });

  it("returns contacts with list ids, lists with counts, and the limits", async () => {
    const [ines] = await seedContacts(workspace.id, 1, "ines");
    const dev = await seedList(workspace.id, "dev team");
    await seedList(workspace.id, "Alumni");
    await adminClient()
      .from("list_contacts")
      .insert({ workspace_id: workspace.id, list_id: dev, contact_id: ines });
    const { data } = await admin.client.rpc("roster", {
      p_workspace: workspace.id,
    });
    expect(data).toEqual({
      contacts: [
        {
          id: ines,
          email: "ines-1@example.test",
          full_name: "ines 1",
          list_ids: [dev],
        },
      ],
      lists: [
        { id: expect.any(String), name: "Alumni", contact_count: 0 },
        { id: dev, name: "dev team", contact_count: 1 },
      ],
      limits: { contacts_max: 2000, lists_max: 50, import_rows_max: 2000 },
    });
  });

  it("refuses non-members", async () => {
    await expectAppError(
      outsider.client.rpc("roster", { p_workspace: workspace.id }),
      "forbidden",
    );
  });
});

describe("set_contact_lists()", () => {
  it("replaces a contact's lists atomically and checks the workspace", async () => {
    const [contact] = await seedContacts(workspace.id, 1, "sara");
    const dev = await seedList(workspace.id, "Dev");
    const events = await seedList(workspace.id, "Events");
    await admin.client.rpc("set_contact_lists", {
      p_contact: contact,
      p_list_ids: [dev, events],
    });
    await admin.client.rpc("set_contact_lists", {
      p_contact: contact,
      p_list_ids: [events],
    });
    const links = await adminClient()
      .from("list_contacts")
      .select("list_id")
      .eq("contact_id", contact);
    expect(links.data).toEqual([{ list_id: events }]);

    const other = await createWorkspaceAs(owner, "Elsewhere");
    const foreign = await seedList(other.id, "Foreign");
    await expectAppError(
      admin.client.rpc("set_contact_lists", {
        p_contact: contact,
        p_list_ids: [foreign],
      }),
      "not_found",
    );
    await expectAppError(
      viewer.client.rpc("set_contact_lists", {
        p_contact: contact,
        p_list_ids: [],
      }),
      "forbidden",
    );
  });
});

describe("bulk_contacts()", () => {
  it("adds to, removes from a list, and deletes, ignoring other workspaces' ids", async () => {
    const ids = await seedContacts(workspace.id, 3, "bulk");
    const list = await seedList(workspace.id, "Media");
    const other = await createWorkspaceAs(owner, "Other");
    const [foreign] = await seedContacts(other.id, 1, "foreign");

    const added = await admin.client.rpc("bulk_contacts", {
      p_workspace: workspace.id,
      p_action: "add_to_list",
      p_contact_ids: [...ids, foreign],
      p_list_id: list,
    });
    expect(added.data).toBe(3);
    const removed = await admin.client.rpc("bulk_contacts", {
      p_workspace: workspace.id,
      p_action: "remove_from_list",
      p_contact_ids: [ids[0]],
      p_list_id: list,
    });
    expect(removed.data).toBe(1);
    const deleted = await admin.client.rpc("bulk_contacts", {
      p_workspace: workspace.id,
      p_action: "delete",
      p_contact_ids: [ids[1], foreign],
    });
    expect(deleted.data).toBe(1);
    expect(
      (await adminClient().from("contacts").select("id").eq("id", foreign))
        .data,
    ).toHaveLength(1);
    await expectAppError(
      viewer.client.rpc("bulk_contacts", {
        p_workspace: workspace.id,
        p_action: "delete",
        p_contact_ids: ids,
      }),
      "forbidden",
    );
    await expectAppError(
      admin.client.rpc("bulk_contacts", {
        p_workspace: workspace.id,
        p_action: "explode",
        p_contact_ids: ids,
      }),
      "invalid_input",
    );
  });
});
