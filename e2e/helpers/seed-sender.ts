import { createCipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

/**
 * Test-only secrets for the e2e app build (fixed values committed as fixtures; they protect
 * nothing: the e2e stack is local and its Gmail is fake).
 */
export const E2E_TOKEN_KEY = "bEgAHTsHr/P8FFWGnUzEAcdwaRuecbF18St703MbQFA=";
export const E2E_INVITE_SECRET = "a7gLyNrhsy-jtLpjF4-4ODIA7qip_EP4vXv7ptHDfU4";
export const E2E_DISPATCH_SECRET =
  "e2e-dispatch-secret-not-used-anywhere-real-0001";

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

/**
 * Seals like `sealSecret` in src/server/crypto/secret-box.ts (AES-256-GCM, `v1.<iv>.<ct>.<tag>`,
 * associated data `google_connection:<user>:<sub>`). Copied because that module is server-only;
 * keep the two in sync.
 */
function seal(plaintext: string, userId: string, googleSub: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(E2E_TOKEN_KEY, "base64"),
    iv,
    { authTagLength: 16 },
  );
  cipher.setAAD(
    Buffer.from(`google_connection:${userId}:${googleSub}`, "utf8"),
  );
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

/** Gives the workspace at `slug` a working (fake) Gmail sender owned by its Owner. */
export async function seedSender(slug: string, gmail: string): Promise<void> {
  const client = admin();
  const workspace = await client
    .from("workspaces")
    .select("id")
    .eq("slug", slug)
    .single();
  if (workspace.error) {
    throw workspace.error;
  }
  const owner = await client
    .from("workspace_roles")
    .select("user_id")
    .eq("workspace_id", workspace.data.id)
    .eq("role", "owner")
    .single();
  if (owner.error) {
    throw owner.error;
  }
  const userId = owner.data.user_id;
  const googleSub = `e2e-${crypto.randomUUID()}`;
  const connection = await client
    .from("google_connections")
    .insert({
      user_id: userId,
      google_sub: googleSub,
      google_email: gmail,
      granted_scopes: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/gmail.send",
      ],
      refresh_token_encrypted: seal("1//e2e-refresh", userId, googleSub),
    })
    .select("id")
    .single();
  if (connection.error) {
    throw connection.error;
  }
  const updated = await client
    .from("workspaces")
    .update({ sender_connection_id: connection.data.id })
    .eq("id", workspace.data.id);
  if (updated.error) {
    throw updated.error;
  }
}
