import "server-only";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  API_ERROR_CODES,
  API_ERROR_STATUS,
  type ApiErrorCode,
} from "@/shared/api/errors";

/** JSON error response in the shared `{ error: { code, details? } }` shape. */
export function apiError(
  code: ApiErrorCode,
  details?: Record<string, string>,
): NextResponse {
  return NextResponse.json(
    { error: details ? { code, details } : { code } },
    { status: API_ERROR_STATUS[code] },
  );
}

/** `{ ok: true }` for mutations without a richer result. */
export function ok(): NextResponse {
  return NextResponse.json({ ok: true });
}

const POSTGRES_CODES: Record<string, ApiErrorCode> = {
  "42501": "forbidden",
  "23514": "invalid_input",
  "23502": "invalid_input",
  "22P02": "invalid_input",
  // A NUL character in text (anything Zod didn't already strip) is bad input, not a crash.
  "22P05": "invalid_input",
  "23505": "conflict",
};

function isApiErrorCode(value: string): value is ApiErrorCode {
  return API_ERROR_CODES.some((code) => code === value);
}

/**
 * Converts a Supabase/PostgREST error into an API error. `tn:<code>` messages come from our
 * database functions; `overrides` let a route name what a Postgres code means for it (e.g. a
 * unique violation on contacts is `contact_email_taken`); anything unexpected is logged and
 * returned as `internal`.
 */
export function fromDatabaseError(
  error: { code?: string; message: string },
  overrides: Readonly<Record<string, ApiErrorCode>> = {},
): NextResponse {
  const appCode = /^tn:([a-z_]+)$/.exec(error.message)?.[1];
  if (appCode && isApiErrorCode(appCode)) {
    return apiError(appCode);
  }
  const mapped = error.code
    ? (overrides[error.code] ?? POSTGRES_CODES[error.code])
    : undefined;
  if (mapped) {
    return apiError(mapped);
  }
  logger.error({ err: error }, "unexpected database error");
  return apiError("internal");
}
