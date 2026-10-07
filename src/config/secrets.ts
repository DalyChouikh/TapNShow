import "server-only";
import { getServerEnv, type ServerEnv } from "./env";

/** Secrets some features need but the app can boot without (CI, previews without sending). */
export type SecretName =
  | "GOOGLE_TOKEN_ENCRYPTION_KEY"
  | "INVITE_TOKEN_SECRET"
  | "DISPATCH_SECRET"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET";

/**
 * Returns a secret the caller cannot work without.
 * @throws Error naming the variable (never its value) when it is not set
 */
export function requireSecret(
  name: SecretName,
  env: ServerEnv = getServerEnv(),
): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}
