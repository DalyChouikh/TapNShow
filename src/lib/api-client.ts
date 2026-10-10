import type { z } from "zod";
import { apiErrorBodySchema, type ApiErrorCode } from "@/shared/api/errors";
import { redirectToLogin } from "./auth-redirect";

/** Error thrown for every non-2xx API response. */
export class ApiClientError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    readonly details?: Record<string, string>,
  ) {
    super(code);
    this.name = "ApiClientError";
  }
}

/** The `ApiErrors` code to show for a failed request: `internal` for anything but an API error. */
export function errorCodeOf(error: Error): ApiErrorCode {
  return error instanceof ApiClientError ? error.code : "internal";
}

/**
 * Calls one of our API routes and validates the JSON response with `schema`.
 * A 401 triggers `onUnauthenticated` (default: go to sign-in with `next`).
 * @throws ApiClientError for every non-2xx response
 */
export async function apiRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: object;
    schema: z.ZodType<T>;
    onUnauthenticated?: () => void;
  },
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.ok) {
    return options.schema.parse(await response.json());
  }
  if (response.status === 401) {
    (options.onUnauthenticated ?? redirectToLogin)();
  }
  const parsed = apiErrorBodySchema.safeParse(
    await response.json().catch(() => null),
  );
  throw parsed.success
    ? new ApiClientError(
        parsed.data.error.code,
        response.status,
        parsed.data.error.details,
      )
    : new ApiClientError("internal", response.status);
}
