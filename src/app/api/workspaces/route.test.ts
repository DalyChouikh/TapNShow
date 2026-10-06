import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => ({ id: "u1", email: "a@example.test" }),
}));
vi.mock("@/server/queries/workspaces", () => ({
  createWorkspace: mocks.createWorkspace,
}));

const post = (body: object) =>
  new Request("http://localhost:3000/api/workspaces", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/workspaces", () => {
  it("creates with a generated slug and answers 201", async () => {
    mocks.createWorkspace.mockImplementationOnce(
      async (_client: object, input: { slug: string }) => ({
        data: { slug: input.slug },
        error: null,
      }),
    );
    const { POST } = await import("./route");
    const response = await POST(
      post({ name: "Robotics Club", timezone: "Africa/Tunis" }),
    );
    expect(response.status).toBe(201);
    expect((await response.json()).slug).toMatch(/^robotics-club-[a-z0-9]{4}$/);
  });

  it("retries a slug collision with a new suffix", async () => {
    mocks.createWorkspace
      .mockResolvedValueOnce({
        data: null,
        error: { code: "23505", message: "duplicate key" },
      })
      .mockImplementationOnce(
        async (_client: object, input: { slug: string }) => ({
          data: { slug: input.slug },
          error: null,
        }),
      );
    const { POST } = await import("./route");
    expect(
      (await POST(post({ name: "Club", timezone: "Africa/Tunis" }))).status,
    ).toBe(201);
    expect(mocks.createWorkspace).toHaveBeenCalledTimes(2);
  });

  it("passes database refusals through", async () => {
    mocks.createWorkspace.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:workspace_limit" },
    });
    const { POST } = await import("./route");
    const response = await POST(
      post({ name: "Club", timezone: "Africa/Tunis" }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "workspace_limit" },
    });
  });
});
