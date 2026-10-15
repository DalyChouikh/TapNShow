import { createHash, randomBytes } from "node:crypto";
import type { TestUser } from "./clients";

/** Creates a workspace invite as `by` and returns its token hash (the raw token is never needed). */
export async function createInviteAs(
  by: TestUser,
  workspaceId: string,
  email: string,
  role: "admin" | "viewer",
): Promise<string> {
  const tokenHash = createHash("sha256").update(randomBytes(32)).digest("hex");
  const { error } = await by.client.rpc("create_invite", {
    p_workspace: workspaceId,
    p_email: email,
    p_role: role,
    p_token_hash: tokenHash,
  });
  if (error) {
    throw error;
  }
  return tokenHash;
}
