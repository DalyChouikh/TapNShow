import { NextResponse } from "next/server";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { loadTokenContext } from "@/server/http/token-context";
import { unsubscribeToken } from "@/server/queries/tokens";

type Ctx = RouteContext<"/api/r/[token]/unsubscribe">;

/** A browser opening the List-Unsubscribe link lands on the confirmation page (never a GET side effect). */
export async function GET(request: Request, ctx: Ctx): Promise<NextResponse> {
  const { token } = await ctx.params;
  return NextResponse.redirect(new URL(`/u/${token}`, request.url), 303);
}

/**
 * Unsubscribes from this workspace. Serves our page's button and RFC 8058 one-click POSTs from mail
 * providers, so there is no Origin check: the token is the credential and no cookie is involved.
 */
export async function POST(request: Request, ctx: Ctx): Promise<NextResponse> {
  const { token } = await ctx.params;
  const context = await loadTokenContext(request, token);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await unsubscribeToken(
    context.client,
    context.tokenHash,
    "link",
  );
  if (error) {
    return fromDatabaseError(error);
  }
  return data ? ok() : apiError("not_found");
}
