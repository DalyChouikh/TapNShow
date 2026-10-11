import { adminClient } from "./clients";

/**
 * Inserts a Google connection for `userId` (service role; the token is an opaque test string, not
 * a real ciphertext). `scopes` default to a Gmail sender's. Returns its id and Google account id.
 */
export async function seedConnection(
  userId: string,
  options: {
    email?: string;
    sub?: string;
    status?: "active" | "broken";
    scopes?: string[];
  } = {},
): Promise<{ id: string; sub: string }> {
  const sub = options.sub ?? `sub-${crypto.randomUUID()}`;
  const { data, error } = await adminClient()
    .from("google_connections")
    .insert({
      user_id: userId,
      google_sub: sub,
      google_email:
        options.email ??
        `sender-${crypto.randomUUID().slice(0, 8)}@example.test`,
      granted_scopes: [
        "openid",
        "email",
        ...(options.scopes ?? ["https://www.googleapis.com/auth/gmail.send"]),
      ],
      refresh_token_encrypted: "v1.test.test.test",
      status: options.status ?? "active",
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  return { id: data.id, sub };
}

/** Makes `connectionId` the workspace's sender (service role, bypasses the Owner check). */
export async function setSender(
  workspaceId: string,
  connectionId: string | null,
): Promise<void> {
  const { error } = await adminClient()
    .from("workspaces")
    .update({ sender_connection_id: connectionId })
    .eq("id", workspaceId);
  if (error) {
    throw error;
  }
}
