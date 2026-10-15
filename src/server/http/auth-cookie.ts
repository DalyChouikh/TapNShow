import "server-only";

const SESSION_COOKIE_NAME = /^sb-[^=;]+-auth-token(?:\.\d+)?$/;

/**
 * Whether a cookie name is a Supabase session cookie (`@supabase/ssr` names it
 * `sb-<ref>-auth-token`, split into `.0`, `.1` … when long). Server components use it with
 * `cookies()`; routes use `hasAuthCookie`.
 */
export function isSessionCookieName(name: string): boolean {
  return SESSION_COOKIE_NAME.test(name);
}

/**
 * Whether the request carries a Supabase session cookie. Public pages use it to skip the session
 * check for the many visitors who never signed in.
 */
export function hasAuthCookie(request: Request): boolean {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .some((part) => isSessionCookieName(part.split("=", 1)[0]?.trim() ?? ""));
}
