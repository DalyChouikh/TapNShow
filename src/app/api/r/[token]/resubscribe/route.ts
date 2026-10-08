import type { NextResponse } from "next/server";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { loadTokenContext } from "@/server/http/token-context";
import { resubscribeToken } from "@/server/queries/tokens";

/** Clears the unsubscribe: only the person, through their own link, can (spec §7.16). The token is the credential; no cookie is involved, so no Origin check. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/r/[token]/resubscribe">,
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const context = await loadTokenContext(request, token);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await resubscribeToken(
    context.client,
    context.tokenHash,
  );
  if (error) {
    return fromDatabaseError(error);
  }
  return data ? ok() : apiError("not_found");
}
