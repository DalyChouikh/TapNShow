import "server-only";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/config/env";
import { loginPathFor } from "@/lib/auth-redirect";
import type { Database } from "@/server/db/database.types";

/** Pages that need a session. API routes check sessions themselves (401). */
export function requiresSession(pathname: string): boolean {
  return ["/welcome", "/w", "/invites", "/account"].some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
}

/**
 * Continues to the page with the request's own headers (cookies as refreshed by Supabase, which
 * `request.cookies.set` keeps in the cookie header) plus the proxy's extra ones (the CSP nonce).
 */
function forward(request: NextRequest, extra: Headers): NextResponse {
  const headers = new Headers(request.headers);
  extra.forEach((value, key) => headers.set(key, value));
  return NextResponse.next({ request: { headers } });
}

/**
 * Refreshes the Supabase session cookies on every request (`getClaims` verifies the JWT),
 * and sends signed-out visitors of protected pages to `/login?next=…`. This is an optimistic
 * check only (Next docs): every API route re-checks the session. `extra` headers (the CSP nonce)
 * reach the page with the request.
 */
export async function updateSession(
  request: NextRequest,
  extra: Headers,
): Promise<NextResponse> {
  const env = getServerEnv();
  let response = forward(request, extra);
  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers?: Record<string, string>) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = forward(request, extra);
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers ?? {})) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );
  const { data } = await supabase.auth.getClaims();
  const { pathname, search } = request.nextUrl;
  if (!data?.claims && requiresSession(pathname)) {
    const redirect = NextResponse.redirect(
      new URL(loginPathFor(`${pathname}${search}`), request.url),
    );
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  }
  return response;
}
