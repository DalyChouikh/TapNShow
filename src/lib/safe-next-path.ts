const PROBE_ORIGIN = "https://tapnshow.invalid";

/** Paths a browser would treat as another host (`//host`, `/\\host`). */
function leavesSite(path: string): boolean {
  return path.startsWith("//") || path.startsWith("/\\");
}

/**
 * Returns `value` as a same-site path (pathname + search + hash), or null when it could
 * leave the site (absolute URLs, protocol-relative `//`, backslash tricks, control
 * characters that URL parsing strips, and dot segments like `/..//host` that only become
 * `//host` after parsing — so the check runs again on the normalized result).
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || leavesSite(value)) {
    return null;
  }
  try {
    const url = new URL(value, PROBE_ORIGIN);
    const path = `${url.pathname}${url.search}${url.hash}`;
    return url.origin === PROBE_ORIGIN && !leavesSite(path) ? path : null;
  } catch {
    return null;
  }
}
