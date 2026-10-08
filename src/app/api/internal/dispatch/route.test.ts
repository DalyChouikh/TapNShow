import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  secret: { value: "s".repeat(43) as string | undefined },
  schedule: vi.fn(),
}));
vi.mock("@/config/env", () => ({
  getServerEnv: () => ({
    DISPATCH_SECRET: mocks.secret.value,
    LOG_LEVEL: "info",
  }),
}));
vi.mock("@/server/dispatch/schedule-dispatch", () => ({
  scheduleDispatch: mocks.schedule,
}));

const post = (authorization?: string) =>
  new Request("http://localhost:3000/api/internal/dispatch", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.secret.value = "s".repeat(43);
});

describe("POST /api/internal/dispatch", () => {
  it("starts a run for the right secret", async () => {
    const { POST } = await import("./route");
    const response = await POST(post(`Bearer ${"s".repeat(43)}`));
    expect(response.status).toBe(202);
    expect(mocks.schedule).toHaveBeenCalledTimes(1);
  });

  it("refuses a wrong or missing secret and hides the route where it is not configured", async () => {
    const { POST } = await import("./route");
    expect((await POST(post("Bearer nope"))).status).toBe(401);
    expect((await POST(post())).status).toBe(401);
    mocks.secret.value = undefined;
    expect((await POST(post(`Bearer ${"s".repeat(43)}`))).status).toBe(404);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});
