/** The legal pages (spec §7.18). Every link to them uses these paths; a test checks each exists. */
export const LEGAL_LINKS = { privacy: "/privacy", terms: "/terms" } as const;

/** The Contact link: the platform sender address (server setting `SMTP_FROM`, never in the repo). */
export function contactHref(address: string): string {
  return `mailto:${address}`;
}
