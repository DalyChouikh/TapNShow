/**
 * Hosted Supabase projects. Refs are not secret. `siteUrl` is Supabase Auth's `site_url`:
 * production uses the public app; preview is used by local development, so it points at localhost.
 */
export const SUPABASE_PROJECTS = {
  prod: { ref: "dysqhjvwabqahpctytnw", siteUrl: "https://tapnshow.vercel.app" },
  preview: { ref: "wayabcidwnhgaazgsuns", siteUrl: "http://localhost:3000" },
} as const;

/** Name of a hosted Supabase project. */
export type SupabaseProjectName = keyof typeof SUPABASE_PROJECTS;
