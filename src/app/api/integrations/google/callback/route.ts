import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/config/env";
import {
  GMAIL_CONNECT_CALLBACK_PATH,
  GMAIL_CONNECT_COOKIE,
  GMAIL_CONNECT_COOKIE_PATH,
  GMAIL_SEND_SCOPE,
} from "@/config/gmail";
import { DRIVE_FILE_SCOPE } from "@/config/sheets";
import { publicEnv } from "@/config/public-env";
import { requireSecret } from "@/config/secrets";
import { loginPathFor } from "@/lib/auth-redirect";
import { logger } from "@/lib/logger";
import { resultPath, settingsPath } from "@/lib/with-query";
import {
  connectionAssociatedData,
  parseEncryptionKey,
  sealSecret,
} from "@/server/crypto/secret-box";
import { tokensEqual } from "@/server/crypto/tokens";
import {
  decodeConnectCookie,
  exchangeGoogleCode,
  revokeGoogleToken,
  type GoogleConnectGrant,
} from "@/server/google/google-oauth";
import { revokeReleased } from "@/server/google/release";
import { requireUser } from "@/server/http/require-user";
import {
  saveGoogleConnection,
  setWorkspaceSender,
} from "@/server/queries/sender";
import { googleConnectionSaved, startSheet } from "@/server/queries/sheets";
import { getWorkspaceBySlug } from "@/server/queries/workspaces";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { scheduleWorkers } from "@/server/workers/schedule-workers";
import {
  GOOGLE_RESULT_PARAMS,
  type GoogleConnectError,
} from "@/shared/api/google-connect";

function redirectClearingCookie(
  path: string,
  request: NextRequest,
): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url));
  response.cookies.delete({
    name: GMAIL_CONNECT_COOKIE,
    path: GMAIL_CONNECT_COOKIE_PATH,
  });
  return response;
}

/** `after()` work may run this long (the sheet worker started here keeps to its own budget). */
export const maxDuration = 60;

/**
 * Finishes a Google connection (spec §9): verify state, exchange, check scopes, seal, save, re-check
 * the sheets on that account, then set the sender (`sending`) or start the sheet (`sheets`). A
 * grant holding either permission is kept even when the purpose's own box was unticked: with
 * incremental consent it can carry the other purpose's permission, which must not be revoked.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  const stored = decodeConnectCookie(
    request.cookies.get(GMAIL_CONNECT_COOKIE)?.value,
  );
  if (!stored) {
    return redirectClearingCookie("/welcome", request);
  }
  const returnTo =
    stored.next ?? settingsPath(stored.workspaceSlug, stored.purpose);
  const fail = (reason: GoogleConnectError) =>
    redirectClearingCookie(
      resultPath(returnTo, stored.purpose, GOOGLE_RESULT_PARAMS.error, reason),
      request,
    );
  const params = request.nextUrl.searchParams;
  if (params.get("error") === "access_denied") {
    return fail("cancelled");
  }
  const code = params.get("code");
  const state = params.get("state");
  if (
    !code ||
    !state ||
    params.get("error") ||
    !tokensEqual(state, stored.state)
  ) {
    return fail("failed");
  }
  if (
    !publicEnv.NEXT_PUBLIC_GMAIL_CONNECT_ENABLED ||
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET
  ) {
    return fail("unavailable");
  }
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return redirectClearingCookie(loginPathFor(returnTo), request);
  }
  const workspace = await getWorkspaceBySlug(
    supabase,
    user.id,
    stored.workspaceSlug,
  );
  if (!workspace || workspace.myRole !== "owner") {
    return fail("owner_only");
  }
  let grant: GoogleConnectGrant;
  try {
    grant = await exchangeGoogleCode({
      code,
      verifier: stored.verifier,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${publicEnv.NEXT_PUBLIC_APP_URL}${GMAIL_CONNECT_CALLBACK_PATH}`,
    });
  } catch (error) {
    logger.error({ err: error }, "Google connect code exchange failed");
    return fail("failed");
  }
  const purposeScope =
    stored.purpose === "sheets" ? DRIVE_FILE_SCOPE : GMAIL_SEND_SCOPE;
  const usable =
    grant.scopes.includes(GMAIL_SEND_SCOPE) ||
    grant.scopes.includes(DRIVE_FILE_SCOPE);
  if (!usable) {
    if (grant.refreshToken) {
      await revokeGoogleToken(grant.refreshToken);
    }
    return fail("scope_denied");
  }
  if (!grant.refreshToken) {
    return fail("no_refresh_token");
  }
  if (!grant.claims.emailVerified) {
    await revokeGoogleToken(grant.refreshToken);
    return fail("failed");
  }
  const key = parseEncryptionKey(
    requireSecret("GOOGLE_TOKEN_ENCRYPTION_KEY", env),
  );
  const admin = createSupabaseAdminClient();
  const saved = await saveGoogleConnection(admin, {
    userId: user.id,
    googleSub: grant.claims.sub,
    googleEmail: grant.claims.email,
    scopes: grant.scopes,
    tokenEncrypted: sealSecret(
      grant.refreshToken,
      key,
      connectionAssociatedData(user.id, grant.claims.sub),
    ),
  });
  if (saved.error || !saved.data) {
    logger.error({ err: saved.error }, "saving the Google connection failed");
    return fail("failed");
  }
  const resumed = await googleConnectionSaved(admin, {
    userId: user.id,
    connectionId: saved.data,
  });
  if (resumed.error) {
    logger.error(
      { err: resumed.error },
      "re-checking the account's sheets failed",
    );
  }
  if (!grant.scopes.includes(purposeScope)) {
    return fail("scope_denied");
  }
  if (stored.purpose === "sending") {
    const sender = await setWorkspaceSender(supabase, workspace.id, saved.data);
    if (sender.error) {
      logger.error(
        { err: sender.error },
        "setting the workspace sender failed",
      );
      return fail("failed");
    }
  } else {
    const started = await startSheet(admin, {
      userId: user.id,
      workspaceId: workspace.id,
      connectionId: saved.data,
      replace: stored.replace,
    });
    if (started.error) {
      if (started.error.message === "tn:sheet_wrong_account") {
        return fail("sheet_wrong_account");
      }
      logger.error({ err: started.error }, "starting the Google Sheet failed");
      return fail("failed");
    }
    await revokeReleased([started.data?.released ?? null]);
    scheduleWorkers(["sheets"]);
  }
  return redirectClearingCookie(
    resultPath(
      returnTo,
      stored.purpose,
      GOOGLE_RESULT_PARAMS.done,
      "connected",
    ),
    request,
  );
}
