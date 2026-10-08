import { z } from "zod";
import { blankToUndefined, formatEnvError, type EnvSource } from "./env-utils";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
  NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: z.string().min(1).optional(),
  NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED: z.stringbool().default(false),
  NEXT_PUBLIC_GMAIL_CONNECT_ENABLED: z.stringbool().default(false),
  NEXT_PUBLIC_VERCEL_ENV: z
    .enum(["production", "preview", "development"])
    .optional(),
});

/** Environment variables that are safe to expose to the browser. */
export type PublicEnv = z.infer<typeof publicEnvSchema>;

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

/**
 * Validated public env. Each variable is referenced literally so Next.js can inline it
 * into client bundles.
 */
export const publicEnv: PublicEnv = parsePublicEnv({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION:
    process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
  NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED:
    process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED,
  NEXT_PUBLIC_GMAIL_CONNECT_ENABLED:
    process.env.NEXT_PUBLIC_GMAIL_CONNECT_ENABLED,
  NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
});
