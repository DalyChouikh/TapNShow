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
