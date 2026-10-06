import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import type { Database } from "@/server/db/database.types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is missing: run DB tests with \`bun run test:db\``,
    );
  }
  return value;
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

/** Service-role client for test setup only (bypasses RLS). */
export function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SECRET_KEY"),
    noSession,
  );
}

/** Signed-out client (the `anon` role). */
export function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    noSession,
  );
}

/** A confirmed user and a client signed in as them. */
export type TestUser = {
  id: string;
  email: string;
  client: SupabaseClient<Database>;
};

/**
 * Creates a confirmed user (password sign-in is used only by tests) and signs in.
 * @param options.fullName - display name written to the profile (test fixture)
 */
export async function createTestUser(
  options: { email?: string; fullName?: string } = {},
): Promise<TestUser> {
  const email = options.email ?? `user-${crypto.randomUUID()}@example.test`;
  const password = crypto.randomUUID();
  const created = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) {
    throw created.error;
  }
  if (options.fullName) {
    const named = await adminClient()
      .from("profiles")
      .update({ display_name: options.fullName })
      .eq("user_id", created.data.user.id);
    if (named.error) {
      throw named.error;
    }
  }
  const client = anonClient();
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) {
    throw signedIn.error;
  }
  return { id: created.data.user.id, email, client };
}

/** Asserts that a Supabase call failed with `tn:<code>` (our database error convention). */
export async function expectAppError(
  call: PromiseLike<{ error: { message: string } | null }>,
  code: string,
): Promise<void> {
  const { error } = await call;
  expect(error?.message).toBe(`tn:${code}`);
}
