import type { NextResponse } from "next/server";
import { apiError } from "@/server/http/errors";

/**
 * Any `/api/…` address no route handles (spec §7.18): JSON 404, never the HTML not-found page.
 * Specific routes always win over this catch-all.
 */
function notFound(): NextResponse {
  return apiError("not_found");
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
