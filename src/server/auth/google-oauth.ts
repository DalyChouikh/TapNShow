import "server-only";
import { z } from "zod";
import {
  GOOGLE_AUTHORIZATION_ENDPOINT,
  GOOGLE_SCOPES,
  GOOGLE_TOKEN_ENDPOINT,
} from "@/config/auth";
import {
  generateToken,
  sha256Base64Url,
  sha256Hex,
} from "@/server/crypto/tokens";

const oauthStateSchema = z.object({
  state: z.string().min(1),
  verifier: z.string().min(1),
  nonce: z.string().min(1),
  next: z.string().nullable(),
});

/** What the start route remembers (in an httpOnly cookie) for the callback. */
export type GoogleOAuthState = z.infer<typeof oauthStateSchema>;

/** Builds Google's authorization URL with state, PKCE (S256) and a hashed nonce. */
export function createGoogleAuthorization(input: {
  clientId: string;
  redirectUri: string;
  next: string | null;
}): {
  url: string;
  state: GoogleOAuthState;
} {
  const state: GoogleOAuthState = {
    state: generateToken(),
    verifier: generateToken(),
    nonce: generateToken(),
    next: input.next,
  };
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    state: state.state,
    code_challenge: sha256Base64Url(state.verifier),
    code_challenge_method: "S256",
    nonce: sha256Hex(state.nonce),
    prompt: "select_account",
  });
  return {
    url: `${GOOGLE_AUTHORIZATION_ENDPOINT}?${params.toString()}`,
    state,
  };
}

/** Cookie-safe encoding (base64url JSON). */
export function encodeOAuthCookie(state: GoogleOAuthState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

/** Decodes the cookie; null when missing or malformed. */
export function decodeOAuthCookie(
  value: string | undefined,
): GoogleOAuthState | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = oauthStateSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const tokenResponseSchema = z.object({ id_token: z.string().min(1) });

/**
 * Exchanges the authorization code (with the PKCE verifier and client secret) for Google's ID token.
 * @throws Error naming only the HTTP status (Google's body may echo the code)
 */
export async function exchangeGoogleCode(
  input: {
    code: string;
    verifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.verifier,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(
      `Google token exchange failed with HTTP ${response.status}`,
    );
  }
  return tokenResponseSchema.parse(await response.json()).id_token;
}
