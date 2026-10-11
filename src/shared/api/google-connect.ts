/** What a Google connection is for: Gmail sending (M4) or the Google Sheet (M7, spec §9). */
export const GOOGLE_CONNECT_PURPOSES = ["sending", "sheets"] as const;
/** One connect purpose. */
export type GoogleConnectPurpose = (typeof GOOGLE_CONNECT_PURPOSES)[number];

/** `?google_error=` values the connect routes can return. */
export const GOOGLE_CONNECT_ERRORS = [
  "unavailable",
  "owner_only",
  "cancelled",
  "scope_denied",
  "no_refresh_token",
  "failed",
  "rate_limited",
  "sheet_wrong_account",
] as const;
/** One connect failure reason. */
export type GoogleConnectError = (typeof GOOGLE_CONNECT_ERRORS)[number];

/** Query parameters the callback adds on return. */
export const GOOGLE_RESULT_PARAMS = {
  done: "google",
  error: "google_error",
  purpose: "google_for",
} as const;

/**
 * Where "Connect Gmail" / "Connect Google Sheets" / "Create a new sheet" navigate (a full page
 * load: Google's account chooser and consent screen follow).
 */
export function googleConnectHref(
  slug: string,
  purpose: GoogleConnectPurpose,
  options: { next?: string; replace?: boolean } = {},
): string {
  const params = new URLSearchParams({ workspace: slug, purpose });
  if (options.next) {
    params.set("next", options.next);
  }
  if (options.replace) {
    params.set("replace", "1");
  }
  return `/api/integrations/google/connect?${params.toString()}`;
}
