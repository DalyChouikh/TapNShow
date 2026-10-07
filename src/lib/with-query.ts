const BASE = "http://local.invalid";

/** Adds or replaces one query parameter on a same-site path, keeping any hash. */
export function withQuery(path: string, key: string, value: string): string {
  const url = new URL(path, BASE);
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Where the Gmail connect flow returns by default (Settings > Sending). */
export function senderSettingsPath(slug: string): string {
  return `/w/${slug}/settings#sending`;
}
