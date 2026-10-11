import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/config/env";
import {
  GMAIL_CONNECT_CALLBACK_PATH,
  GMAIL_CONNECT_COOKIE,
  GMAIL_CONNECT_COOKIE_MAX_AGE_SECONDS,
  GMAIL_CONNECT_COOKIE_PATH,
} from "@/config/gmail";
import { publicEnv } from "@/config/public-env";
import { loginPathFor } from "@/lib/auth-redirect";
import { safeNextPath } from "@/lib/safe-next-path";
import { resultPath, settingsPath } from "@/lib/with-query";
import {
  createGoogleConnectAuthorization,
  encodeConnectCookie,
} from "@/server/google/google-oauth";
import { requireUser } from "@/server/http/require-user";
import { hitGoogleConnectLimit } from "@/server/queries/sheets";
import { getWorkspaceBySlug } from "@/server/queries/workspaces";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import {
  GOOGLE_CONNECT_PURPOSES,
  GOOGLE_RESULT_PARAMS,
  type GoogleConnectError,
} from "@/shared/api/google-connect";

/**
 * Starts a Google connection for the workspace's Owner (spec §9): Gmail sending, or the Google
 * Sheet (`purpose=sheets`, `replace=1` for "Create a new sheet"). Rate limited per person.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  const params = request.nextUrl.searchParams;
  const slug = params.get("workspace") ?? "";
  const purpose =
    GOOGLE_CONNECT_PURPOSES.find((value) => value === params.get("purpose")) ??
    "sending";
  const replace = params.get("replace") === "1";
  const returnTo =
    safeNextPath(params.get("next")) ??
    (slug ? settingsPath(slug, purpose) : "/welcome");
  const back = (reason: GoogleConnectError) =>
    NextResponse.redirect(
      new URL(
        resultPath(returnTo, purpose, GOOGLE_RESULT_PARAMS.error, reason),
        request.url,
      ),
    );

  if (
    !publicEnv.NEXT_PUBLIC_GMAIL_CONNECT_ENABLED ||
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET
  ) {
    return back("unavailable");
  }
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.redirect(
      new URL(
        loginPathFor(`${request.nextUrl.pathname}${request.nextUrl.search}`),
        request.url,
      ),
    );
  }
  const workspace = slug
    ? await getWorkspaceBySlug(supabase, user.id, slug)
    : null;
  if (!workspace || workspace.myRole !== "owner") {
    return back("owner_only");
  }
  const limit = await hitGoogleConnectLimit(supabase);
  if (limit.error || !limit.data) {
    return back("rate_limited");
  }
  const { url, state } = createGoogleConnectAuthorization({
    clientId: env.GOOGLE_CLIENT_ID,
    redirectUri: `${publicEnv.NEXT_PUBLIC_APP_URL}${GMAIL_CONNECT_CALLBACK_PATH}`,
    workspaceSlug: workspace.slug,
    next: returnTo,
    purpose,
    replace,
  });
  const response = NextResponse.redirect(url);
  response.cookies.set(GMAIL_CONNECT_COOKIE, encodeConnectCookie(state), {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: GMAIL_CONNECT_COOKIE_PATH,
    maxAge: GMAIL_CONNECT_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
