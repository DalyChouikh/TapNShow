import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiClientError, apiRequest } from "./api-client";
import { loginPathFor } from "./auth-redirect";

afterEach(() => vi.unstubAllGlobals());

function respond(status: number, body: object): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

describe("apiRequest", () => {
  const schema = z.object({ name: z.string() });

  it("validates successful responses", async () => {
    respond(200, { name: "Club" });
    await expect(apiRequest("/api/x", { schema })).resolves.toEqual({
      name: "Club",
    });
  });

  it("throws ApiClientError with the server's code", async () => {
    respond(409, { error: { code: "workspace_limit" } });
    await expect(
      apiRequest("/api/x", { schema, method: "POST", body: {} }),
    ).rejects.toMatchObject({ code: "workspace_limit", status: 409 });
  });

  it("passes PUT through with a JSON body", async () => {
    respond(200, { name: "Club" });
    await apiRequest("/api/x", { schema, method: "PUT", body: { a: 1 } });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe('{"a":1}');
  });

  it("sends the user to sign-in on 401", async () => {
    respond(401, { error: { code: "unauthenticated" } });
    const onUnauthenticated = vi.fn();
    await expect(
      apiRequest("/api/x", { schema, onUnauthenticated }),
    ).rejects.toBeInstanceOf(ApiClientError);
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it("treats unreadable error bodies as internal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { status: 502 })),
    );
    await expect(apiRequest("/api/x", { schema })).rejects.toMatchObject({
      code: "internal",
      status: 502,
    });
  });
});

describe("loginPathFor", () => {
  it("keeps the current path as next", () => {
    expect(loginPathFor("/w/club-ab12/settings?tab=people")).toBe(
      "/login?next=%2Fw%2Fclub-ab12%2Fsettings%3Ftab%3Dpeople",
    );
  });
});
