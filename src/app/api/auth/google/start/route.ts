import { NextResponse } from "next/server";
import {
  GOOGLE_CALLBACK_PATH,
  GOOGLE_OAUTH_COOKIE,
  GOOGLE_OAUTH_COOKIE_MAX_AGE_SECONDS,
} from "@/config/auth";
import { getServerEnv } from "@/config/env";
import { publicEnv } from "@/config/public-env";
import { safeNextPath } from "@/lib/safe-next-path";
import {
  createGoogleAuthorization,
  encodeOAuthCookie,
} from "@/server/auth/google-oauth";

/** Starts Google sign-in. Disabled (back to /login) where the client has no redirect URI, e.g. previews. */
export async function GET(request: Request): Promise<NextResponse> {
  const env = getServerEnv();
  if (!publicEnv.NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED || !env.GOOGLE_CLIENT_ID) {
    return NextResponse.redirect(
      new URL("/login?error=google_unavailable", request.url),
    );
  }
  const next = safeNextPath(new URL(request.url).searchParams.get("next"));
  const { url, state } = createGoogleAuthorization({
    clientId: env.GOOGLE_CLIENT_ID,
    redirectUri: `${publicEnv.NEXT_PUBLIC_APP_URL}${GOOGLE_CALLBACK_PATH}`,
    next,
  });
  const response = NextResponse.redirect(url);
  response.cookies.set(GOOGLE_OAUTH_COOKIE, encodeOAuthCookie(state), {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: GOOGLE_OAUTH_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
