import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/** The service-role client, for e2e setup only (the app under test never sees it). */
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("Supabase env missing: run e2e with `bun run test:e2e`");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The id of the workspace at `slug`. */
export async function workspaceIdOf(slug: string): Promise<string> {
  const { data, error } = await adminClient()
    .from("workspaces")
    .select("id")
    .eq("slug", slug)
    .single();
  if (error) {
    throw error;
  }
  return data.id;
}

/** The user id of a workspace's Owner. */
export async function ownerIdOf(workspaceId: string): Promise<string> {
  const { data, error } = await adminClient()
    .from("workspace_roles")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("role", "owner")
    .single();
  if (error) {
    throw error;
  }
  return data.user_id;
}

/** The sign-in email of a workspace's Owner (where Owner alerts go). */
export async function ownerEmailOf(workspaceId: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.getUserById(
    await ownerIdOf(workspaceId),
  );
  if (error || !data.user.email) {
    throw error ?? new Error("the Owner has no email");
  }
  return data.user.email;
}

/**
 * Makes the account signed in on `page` a platform admin (e2e setup: the product adds admins
 * through invites).
 */
export async function makePlatformAdmin(page: Page): Promise<void> {
  const me = await page.request.get("/api/me");
  if (!me.ok()) {
    throw new Error(`/api/me answered ${me.status()}`);
  }
  const { userId } = (await me.json()) as { userId: string };
  const { error } = await adminClient()
    .from("platform_admins")
    .insert({ user_id: userId, role: "admin" });
  if (error) {
    throw error;
  }
}
