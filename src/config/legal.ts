import { SUPABASE_PROJECTS } from "./supabase-projects";

/** The legal pages (spec §7.18). Every link to them uses these paths; a test checks each exists. */
export const LEGAL_LINKS = { privacy: "/privacy", terms: "/terms" } as const;

/** The Contact link: the platform sender address (server setting `SMTP_FROM`, never in the repo). */
export function contactHref(address: string): string {
  return `mailto:${address}`;
}

/**
 * The privacy policy's one public address, linked from every email (spec §7.18): production's,
 * from every environment, because a preview's address dies with the preview.
 */
export const PRIVACY_POLICY_URL = `${SUPABASE_PROJECTS.prod.siteUrl}${LEGAL_LINKS.privacy}`;
