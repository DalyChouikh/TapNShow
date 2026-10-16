import { z } from "zod";
import { blankToUndefined, formatEnvError, type EnvSource } from "./env-utils";
import type { PublicEnv } from "./public-env";

/**
 * The public env's rules (Zod). Runs at build time (`next.config.ts`) and in tests, never in the
 * browser: its twin is `readPublicEnv` (`public-env.ts`), which the twin test keeps equal.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
  NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: z.string().min(1).optional(),
  NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED: z.stringbool().default(false),
  /** Gates every Google connection (Gmail sending and, since M7, Google Sheets); the name predates M7. */
  NEXT_PUBLIC_GMAIL_CONNECT_ENABLED: z.stringbool().default(false),
  /** Web Push public key (VAPID, a 65-byte P-256 point in base64url); reminders need it (spec §8). */
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]{86,88}$/)
    .optional(),
  NEXT_PUBLIC_VERCEL_ENV: z
    .enum(["production", "preview", "development"])
    .optional(),
}) satisfies z.ZodType<PublicEnv, EnvSource>;

/**
 * Validates browser-safe environment variables.
 * @throws Error naming every invalid or missing variable
 */
export function parsePublicEnv(source: EnvSource): PublicEnv {
  const result = publicEnvSchema.safeParse(blankToUndefined(source));
  if (!result.success) {
    throw new Error(formatEnvError(result.error));
  }
  return result.data;
}
