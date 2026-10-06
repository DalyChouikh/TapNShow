import "server-only";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/config/env";
import { loginPathFor } from "@/lib/auth-redirect";
import type { Database } from "@/server/db/database.types";

/** Pages that need a session. API routes check sessions themselves (401). */
export function requiresSession(pathname: string): boolean {
  return (
    pathname === "/welcome" || pathname === "/w" || pathname.startsWith("/w/")
  );
}

/**
 * Refreshes the Supabase session cookies on every request (`getClaims` verifies the JWT),
 * and sends signed-out visitors of protected pages to `/login?next=…`. This is an optimistic
 * check only (Next docs): every API route re-checks the session.
 */
export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  const env = getServerEnv();
  let response = NextResponse.next({ request });
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
          response = NextResponse.next({ request });
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
