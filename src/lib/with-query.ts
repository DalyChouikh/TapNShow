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

/**
 * Where the Gmail connect flow returns by default (Settings > Sending). Only a real slug is used:
 * the value can come from a query string, and `../..//host` must never become a redirect target.
 */
export function senderSettingsPath(slug: string): string {
  return slug.length <= SLUG_MAX && SLUG.test(slug)
    ? `/w/${slug}/settings#sending`
    : "/welcome";
}
