import { NextResponse, type NextRequest } from "next/server";
import { GOOGLE_CALLBACK_PATH, GOOGLE_OAUTH_COOKIE } from "@/config/auth";
import { getServerEnv } from "@/config/env";
import { publicEnv } from "@/config/public-env";
import { logger } from "@/lib/logger";
import {
  decodeOAuthCookie,
  exchangeGoogleCode,
} from "@/server/auth/google-oauth";
import { tokensEqual } from "@/server/crypto/tokens";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

function withNext(path: string, next: string | null): string {
  if (!next) {
    return path;
  }
  return `${path}${path.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`;
}

function redirectClearingCookie(
  path: string,
  request: NextRequest,
): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url));
  response.cookies.delete({
    name: GOOGLE_OAUTH_COOKIE,
    path: "/api/auth/google",
  });
  return response;
}

/** Finishes Google sign-in: verify state, exchange the code, sign in to Supabase with the ID token. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  const stored = decodeOAuthCookie(
    request.cookies.get(GOOGLE_OAUTH_COOKIE)?.value,
  );
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const fail = (next: string | null) =>
    redirectClearingCookie(
      withNext("/login?error=google_failed", next),
      request,
    );

  if (!stored || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return fail(null);
  }
  if (
    !code ||
    !state ||
    params.get("error") ||
    !tokensEqual(state, stored.state)
  ) {
    return fail(stored.next);
  }
  try {
    const idToken = await exchangeGoogleCode({
      code,
      verifier: stored.verifier,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${publicEnv.NEXT_PUBLIC_APP_URL}${GOOGLE_CALLBACK_PATH}`,
    });
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
      nonce: stored.nonce,
    });
    if (error) {
      logger.warn(
        { err: error },
        "signInWithIdToken rejected the Google token",
      );
      return fail(stored.next);
    }
  } catch (error) {
    logger.error({ err: error }, "Google sign-in failed");
    return fail(stored.next);
  }
  return redirectClearingCookie(withNext("/welcome", stored.next), request);
}
