import "server-only";
import { getServerEnv } from "@/config/env";
import { requireSecret } from "@/config/secrets";
import {
  connectionAssociatedData,
  openSecret,
  parseEncryptionKey,
} from "@/server/crypto/secret-box";
import {
  type RefreshResult,
  refreshGoogleAccessToken,
} from "@/server/google/google-oauth";

/**
 * How both workers (Gmail sending, the Google Sheet) turn a stored connection into an access token:
 * open the sealed refresh token, then refresh it at Google.
 * @throws Error naming the first missing secret
 */
export function googleTokenDeps(): {
  refresh: (refreshToken: string) => Promise<RefreshResult>;
  openToken: (sealed: string, userId: string, googleSub: string) => string;
} {
  const env = getServerEnv();
  const key = parseEncryptionKey(
    requireSecret("GOOGLE_TOKEN_ENCRYPTION_KEY", env),
  );
  const clientId = requireSecret("GOOGLE_CLIENT_ID", env);
  const clientSecret = requireSecret("GOOGLE_CLIENT_SECRET", env);
  return {
    refresh: (refreshToken) =>
      refreshGoogleAccessToken({
        refreshToken,
        clientId,
        clientSecret,
        tokenUrl: env.GOOGLE_OAUTH_TOKEN_URL,
      }),
    openToken: (sealed, userId, googleSub) =>
      openSecret(sealed, key, connectionAssociatedData(userId, googleSub)),
  };
}
