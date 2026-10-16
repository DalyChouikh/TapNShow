import { apiError } from "@/server/http/errors";

/** Who calls an admin route in a route test. */
export type AdminCaller = "signed_out" | "member" | "admin" | "owner";

/** `loadAdminContext`'s answer for `caller`: 401 signed out, 404 for a non-admin, else the context. */
export function adminContextAs(caller: AdminCaller) {
  if (caller === "signed_out") {
    return { ok: false as const, response: apiError("unauthenticated") };
  }
  if (caller === "member") {
    return { ok: false as const, response: apiError("not_found") };
  }
  return {
    ok: true as const,
    supabase: {},
    user: { id: "me", email: "me@example.test" },
    role: caller,
  };
}

/** A same-origin request for admin route tests (`body` as JSON). */
export function adminRequest(
  method: string,
  path = "/api/admin/x",
  body?: object,
): Request {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: { origin: "http://localhost:3000" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** The same request from another site (the Origin check must refuse it). */
export function crossSiteRequest(method: string, body?: object): Request {
  return new Request("http://localhost:3000/api/admin/x", {
    method,
    headers: { origin: "https://evil.example" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Route params as Next passes them. */
export function params<T extends Record<string, string>>(values: T) {
  return { params: Promise.resolve(values) };
}
