import type { EnvSource } from "./env-utils";

/** Environment variables that are safe to expose to the browser. */
export type PublicEnv = {
  NEXT_PUBLIC_APP_URL: string;
  NEXT_PUBLIC_SENTRY_DSN?: string;
  NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?: string;
  NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED: boolean;
  /** Gates every Google connection (Gmail sending and, since M7, Google Sheets); the name predates M7. */
  NEXT_PUBLIC_GMAIL_CONNECT_ENABLED: boolean;
  /** Web Push public key (VAPID, a 65-byte P-256 point in base64url); reminders need it (spec §8). */
  NEXT_PUBLIC_VAPID_PUBLIC_KEY?: string;
  NEXT_PUBLIC_VERCEL_ENV?: "production" | "preview" | "development";
};

/** Zod `stringbool`'s default "true" words (twin: `publicEnvSchema` in `public-env-schema.ts`). */
const TRUE_WORDS = new Set(["true", "1", "yes", "on", "y", "enabled"]);
const VERCEL_ENVS = ["production", "preview", "development"] as const;

const present = (value: string | undefined): string | undefined =>
  value === "" ? undefined : value;

/**
 * Reads the public env without Zod, so no page ships Zod just for its settings (the landing must
 * stay light). The values were validated at build time by `parsePublicEnv` (`next.config.ts`), and
 * the twin test keeps both readings equal for valid input.
 */
export function readPublicEnv(source: EnvSource): PublicEnv {
  return {
    NEXT_PUBLIC_APP_URL: source.NEXT_PUBLIC_APP_URL ?? "",
    NEXT_PUBLIC_SENTRY_DSN: present(source.NEXT_PUBLIC_SENTRY_DSN),
    NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: present(
      source.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
    ),
    NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED: TRUE_WORDS.has(
      (source.NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED ?? "").toLowerCase(),
    ),
    NEXT_PUBLIC_GMAIL_CONNECT_ENABLED: TRUE_WORDS.has(
      (source.NEXT_PUBLIC_GMAIL_CONNECT_ENABLED ?? "").toLowerCase(),
    ),
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: present(source.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
    NEXT_PUBLIC_VERCEL_ENV: VERCEL_ENVS.find(
      (name) => name === source.NEXT_PUBLIC_VERCEL_ENV,
    ),
  };
}

/**
 * The public env. Each variable is referenced literally so Next.js can inline it into client
 * bundles.
 */
export const publicEnv: PublicEnv = readPublicEnv({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION:
    process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
  NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED:
    process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED,
  NEXT_PUBLIC_GMAIL_CONNECT_ENABLED:
    process.env.NEXT_PUBLIC_GMAIL_CONNECT_ENABLED,
  NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
});
