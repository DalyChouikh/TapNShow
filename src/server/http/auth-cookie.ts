import "server-only";

const SESSION_COOKIE = /(?:^|;\s*)sb-[^=;]+-auth-token(?:\.\d+)?=/;

/**
 * Whether the request carries a Supabase session cookie (`@supabase/ssr` names it
 * `sb-<ref>-auth-token`, split into `.0`, `.1` … when long). Public pages use it to skip the
 * session check for the many visitors who never signed in.
 */
export function hasAuthCookie(request: Request): boolean {
  return SESSION_COOKIE.test(request.headers.get("cookie") ?? "");
}
