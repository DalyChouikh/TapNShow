import { createClient } from "@supabase/supabase-js";

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("Supabase env missing: run e2e with `bun run test:e2e`");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Adds a named member with `role` to the workspace at `slug` (service role; test setup only). */
export async function seedMember(
  slug: string,
  role: "admin" | "viewer",
  displayName: string,
): Promise<{ id: string; email: string }> {
  const client = admin();
  const email = `seed-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const created = await client.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (created.error) {
    throw created.error;
  }
  const id = created.data.user.id;
  const workspace = await client
    .from("workspaces")
    .select("id")
    .eq("slug", slug)
    .single();
  if (workspace.error) {
    throw workspace.error;
  }
  const profile = await client
    .from("profiles")
    .update({ display_name: displayName })
    .eq("user_id", id);
  const member = await client
    .from("workspace_roles")
    .insert({ workspace_id: workspace.data.id, user_id: id, role });
  if (profile.error || member.error) {
    throw profile.error ?? member.error;
  }
  return { id, email };
}

/** Puts people and their lists straight into a workspace's roster (service role; test setup only). */
export async function seedRoster(
  slug: string,
  people: Array<{ fullName: string; email: string; lists?: string[] }>,
): Promise<void> {
  const client = admin();
  const workspace = await client
    .from("workspaces")
    .select("id")
    .eq("slug", slug)
    .single();
  if (workspace.error) {
    throw workspace.error;
  }
  const workspaceId = workspace.data.id;
  const names = [...new Set(people.flatMap((person) => person.lists ?? []))];
  const lists = names.length
    ? await client
        .from("lists")
        .insert(names.map((name) => ({ workspace_id: workspaceId, name })))
        .select("id, name")
    : { data: [], error: null };
  const contacts = await client
    .from("contacts")
    .insert(
      people.map((person) => ({
        workspace_id: workspaceId,
        email: person.email,
        full_name: person.fullName,
      })),
    )
    .select("id, email");
  if (lists.error || contacts.error) {
    throw lists.error ?? contacts.error;
  }
  const listId = new Map(lists.data.map((list) => [list.name, list.id]));
  const contactId = new Map(
    contacts.data.map((contact) => [contact.email, contact.id]),
  );
  const links = people.flatMap((person) =>
    (person.lists ?? []).map((name) => ({
      workspace_id: workspaceId,
      list_id: listId.get(name) ?? "",
      contact_id: contactId.get(person.email) ?? "",
    })),
  );
  if (links.length) {
    const linked = await client.from("list_contacts").insert(links);
    if (linked.error) {
      throw linked.error;
    }
  }
}
