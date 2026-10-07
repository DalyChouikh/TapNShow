/** Gmail sending scope (sensitive; spec §9). */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/** "Connect Gmail sending": `openid email` tell us which account was connected. */
export const GMAIL_CONNECT_SCOPES = [
  "openid",
  "email",
  GMAIL_SEND_SCOPE,
] as const;

/** Registered redirect path of OAuth client `tapnshow-web` for the connect flow. */
export const GMAIL_CONNECT_CALLBACK_PATH = "/api/integrations/google/callback";

/** httpOnly cookie carrying state + PKCE verifier between connect and callback. */
export const GMAIL_CONNECT_COOKIE = "tn_gmail_connect";

/** The cookie is only sent to the connect routes. */
export const GMAIL_CONNECT_COOKIE_PATH = "/api/integrations/google";

/** The Google round trip must finish within this many seconds. */
export const GMAIL_CONNECT_COOKIE_MAX_AGE_SECONDS = 600;

/** From Google's OAuth 2.0 web-server guide (checked 2026-10-07). */
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/** `users.messages.send` path under `GMAIL_API_BASE_URL`. */
export const GMAIL_SEND_PATH = "/gmail/v1/users/me/messages/send";
