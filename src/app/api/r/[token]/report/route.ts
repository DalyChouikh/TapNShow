import type { NextResponse } from "next/server";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { loadTokenContext } from "@/server/http/token-context";
import { unsubscribeToken } from "@/server/queries/tokens";

/** "Not my group": unsubscribes and records one report for the platform admins (spec §7.16). The token is the credential; no cookie is involved, so no Origin check. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/r/[token]/report">,
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const context = await loadTokenContext(request, token);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await unsubscribeToken(
    context.client,
    context.tokenHash,
    "report",
  );
  if (error) {
    return fromDatabaseError(error);
  }
  return data ? ok() : apiError("not_found");
}
