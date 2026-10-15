import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  secret: { value: "s".repeat(43) as string | undefined },
}));
vi.mock("@/config/env", () => ({
  getServerEnv: () => ({
    DISPATCH_SECRET: mocks.secret.value,
    LOG_LEVEL: "silent",
  }),
}));

const request = (authorization?: string) =>
  new Request("http://localhost:3000/api/internal/dispatch", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });

beforeEach(() => {
  mocks.secret.value = "s".repeat(43);
});

describe("requireInternalSecret", () => {
  it("lets the right secret through", async () => {
    const { requireInternalSecret } = await import("./internal-secret");
    expect(
      requireInternalSecret(request(`Bearer ${"s".repeat(43)}`)),
    ).toBeNull();
  });

  it("refuses a wrong or missing secret", async () => {
    const { requireInternalSecret } = await import("./internal-secret");
    expect(requireInternalSecret(request("Bearer nope"))?.status).toBe(401);
    expect(requireInternalSecret(request())?.status).toBe(401);
  });

  it("hides the route where no secret is configured", async () => {
    mocks.secret.value = undefined;
    const { requireInternalSecret } = await import("./internal-secret");
    expect(
      requireInternalSecret(request(`Bearer ${"s".repeat(43)}`))?.status,
    ).toBe(404);
  });
});
