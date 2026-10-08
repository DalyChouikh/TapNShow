import { NextResponse } from "next/server";
import { apiError, fromDatabaseError } from "@/server/http/errors";
import { loadTokenContext } from "@/server/http/token-context";
import { lookupToken } from "@/server/queries/tokens";

/** What a personal link shows: workspace, masked email, flags, meeting basics (spec §11). */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/r/[token]">,
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const context = await loadTokenContext(request, token);
  if (!context.ok) {
    return context.response;
  }
  const { data, error } = await lookupToken(context.client, context.tokenHash);
  if (error) {
    return fromDatabaseError(error);
  }
  return data ? NextResponse.json(data) : apiError("not_found");
}
