const PROBE_ORIGIN = "https://tapnshow.invalid";

/**
 * Returns `value` as a same-site path (pathname + search + hash), or null when it could
 * leave the site (absolute URLs, protocol-relative `//`, backslash tricks, control
 * characters that URL parsing strips).
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  ) {
    return null;
  }
  try {
    const url = new URL(value, PROBE_ORIGIN);
    return url.origin === PROBE_ORIGIN
      ? `${url.pathname}${url.search}${url.hash}`
      : null;
  } catch {
    return null;
  }
}
