/** Digits in emailed sign-in codes (Supabase `mailer_otp_length`). */
export const OTP_LENGTH = 8;

/** Seconds a sign-in code stays valid (Supabase `mailer_otp_exp`). */
export const OTP_EXPIRY_SECONDS = 900;

/** Seconds before "Resend code" unlocks; Supabase allows one code request per user per 60 s. */
export const OTP_RESEND_SECONDS = 60;

/** Auth emails per hour for the whole project (Supabase `rate_limit_email_sent`, spec §8 budget). */
export const AUTH_EMAILS_PER_HOUR = 15;

/** httpOnly cookie that carries OAuth state, PKCE verifier and nonce between start and callback. */
export const GOOGLE_OAUTH_COOKIE = "tn_google_oauth";

/** The Google round trip must finish within this many seconds. */
export const GOOGLE_OAUTH_COOKIE_MAX_AGE_SECONDS = 600;

/** From https://accounts.google.com/.well-known/openid-configuration (checked 2026-10-05). */
export const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";

/** From the same discovery document. */
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Basic sign-in scopes only (spec §9). */
export const GOOGLE_SCOPES = "openid email profile";

/** Registered redirect path of OAuth client `tapnshow-web`. */
export const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";
