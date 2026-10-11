import { createCipheriv, randomBytes } from "node:crypto";
import { GMAIL_CONNECT_SCOPES } from "../../src/config/gmail";
import { adminClient, ownerIdOf, workspaceIdOf } from "./admin";

/**
 * Test-only secrets for the e2e app build (fixed values committed as fixtures; they protect
 * nothing: the e2e stack is local and its Gmail is fake).
 */
export const E2E_TOKEN_KEY = "bEgAHTsHr/P8FFWGnUzEAcdwaRuecbF18St703MbQFA=";
export const E2E_INVITE_SECRET = "a7gLyNrhsy-jtLpjF4-4ODIA7qip_EP4vXv7ptHDfU4";
export const E2E_DISPATCH_SECRET =
  "e2e-dispatch-secret-not-used-anywhere-real-0001";

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

/**
 * A fake Google account of `userId` that granted `scopes`, with a sealed refresh token the fake
 * Google accepts. Returns the connection id.
 */
export async function seedGoogleConnection(
  userId: string,
  email: string,
  scopes: ReadonlyArray<string>,
): Promise<string> {
  const googleSub = `e2e-${crypto.randomUUID()}`;
  const { data, error } = await adminClient()
    .from("google_connections")
    .insert({
      user_id: userId,
      google_sub: googleSub,
      google_email: email,
      granted_scopes: [...scopes],
      refresh_token_encrypted: seal("1//e2e-refresh", userId, googleSub),
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  return data.id;
}

/** Gives the workspace at `slug` a working (fake) Gmail sender owned by its Owner. */
export async function seedSender(slug: string, gmail: string): Promise<void> {
  const workspaceId = await workspaceIdOf(slug);
  const connectionId = await seedGoogleConnection(
    await ownerIdOf(workspaceId),
    gmail,
    GMAIL_CONNECT_SCOPES,
  );
  const { error } = await adminClient()
    .from("workspaces")
    .update({ sender_connection_id: connectionId })
    .eq("id", workspaceId);
  if (error) {
    throw error;
  }
}
