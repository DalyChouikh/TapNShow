import {
  GOOGLE_RESULT_PARAMS,
  type GoogleConnectPurpose,
} from "@/shared/api/google-connect";
import { safeNextPath } from "./safe-next-path";

const BASE = "http://local.invalid";

/** Same rule as the `workspaces.slug` check: lowercase words joined by single hyphens. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MAX = 64;

/**
 * Adds or replaces one query parameter on a same-site path, keeping any hash. Parsing normalizes
 * dot segments, so the result is checked again: anything that would leave the site becomes "/".
 */
export function withQuery(path: string, key: string, value: string): string {
  const url = new URL(path, BASE);
  url.searchParams.set(key, value);
  return safeNextPath(`${url.pathname}${url.search}${url.hash}`) ?? "/";
}

/** The sections of a workspace's Settings page (each one's `id` and `#hash`). */
export type SettingsSectionId =
  "general" | "meeting-defaults" | "people" | "sending" | "sheets" | "danger";

/**
 * A link to one Settings section (where a Google connect flow returns, Owner alerts, checklists).
 * Only a real slug is used: the value can come from a query string, and `../..//host` must never
 * become a redirect target.
 */
export function settingsPath(slug: string, section: SettingsSectionId): string {
  return slug.length <= SLUG_MAX && SLUG.test(slug)
    ? `/w/${slug}/settings#${section}`
    : "/welcome";
}

/**
 * A Google connect result on the way back (`google` / `google_error`, plus `google_for` naming the
 * purpose), so only the banner of that purpose reacts. Shared by the connect route and the callback.
 */
export function resultPath(
  path: string,
  purpose: GoogleConnectPurpose,
  key: (typeof GOOGLE_RESULT_PARAMS)["done" | "error"],
  value: string,
): string {
  return withQuery(
    withQuery(path, key, value),
    GOOGLE_RESULT_PARAMS.purpose,
    purpose,
  );
}
