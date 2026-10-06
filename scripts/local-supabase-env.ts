import { z } from "zod";

/** Mailpit's SMTP port in the local stack (`[local_smtp] smtp_port` in supabase/config.toml). */
export const LOCAL_SMTP_PORT = "44325";

/** App URL used by Playwright and the local e2e build. */
export const LOCAL_APP_URL = "http://localhost:3000";

const localStatusSchema = z.object({
  API_URL: z.url(),
  PUBLISHABLE_KEY: z.string().min(1),
  SECRET_KEY: z.string().min(1),
  MAILPIT_URL: z.url(),
});

/** The parts of `supabase status -o json` the app needs. */
export type LocalStatus = z.infer<typeof localStatusSchema>;

/**
 * Parses `supabase status -o json` output.
 * @throws ZodError naming the missing fields
 */
export function parseLocalStatus(json: string): LocalStatus {
  return localStatusSchema.parse(JSON.parse(json));
}

/** Environment that points the app, DB tests and e2e at the local Supabase stack. */
export function localSupabaseEnv(status: LocalStatus): Record<string, string> {
  return {
    NEXT_PUBLIC_APP_URL: LOCAL_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: status.SECRET_KEY,
    MAILPIT_URL: status.MAILPIT_URL,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: LOCAL_SMTP_PORT,
    SMTP_FROM: "no-reply@tapnshow.test",
    SMTP_REQUIRE_TLS: "false",
    NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED: "false",
  };
}
