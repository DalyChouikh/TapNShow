import "server-only";
import { z } from "zod";
import { getServerEnv } from "@/config/env";
import { requireSecret } from "@/config/secrets";
import { logger } from "@/lib/logger";
import {
  connectionAssociatedData,
  openSecret,
  parseEncryptionKey,
} from "@/server/crypto/secret-box";
import { revokeGoogleToken } from "./google-oauth";

/** A Google connection the database deleted because nothing uses it any more (spec §9). */
export type ReleasedConnection = {
  tokenEncrypted: string;
  googleSub: string;
  userId: string;
};

/** `private.release_connection`'s result (null: kept or already gone). */
export const releasedSchema = z
  .object({
    refresh_token_encrypted: z.string(),
    google_sub: z.string(),
    user_id: z.uuid(),
  })
  .nullable()
  .transform((db): ReleasedConnection | null =>
    db
      ? {
          tokenEncrypted: db.refresh_token_encrypted,
          googleSub: db.google_sub,
          userId: db.user_id,
        }
      : null,
  );

/**
 * Revokes released connections at Google (best effort; Google's revoke removes every permission of
 * that grant). Never throws; logs counts only.
 */
export async function revokeReleased(
  released: ReadonlyArray<ReleasedConnection | null>,
): Promise<void> {
  const targets = released.filter(
    (item): item is ReleasedConnection => item !== null,
  );
  if (targets.length === 0) {
    return;
  }
  let failed = 0;
  try {
    const key = parseEncryptionKey(
      requireSecret("GOOGLE_TOKEN_ENCRYPTION_KEY", getServerEnv()),
    );
    for (const target of targets) {
      try {
        const token = openSecret(
          target.tokenEncrypted,
          key,
          connectionAssociatedData(target.userId, target.googleSub),
        );
        if (!(await revokeGoogleToken(token))) {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
  } catch {
    failed = targets.length;
  }
  if (failed > 0) {
    logger.warn(
      { failed, total: targets.length },
      "Google did not confirm every token revocation",
    );
  }
}
