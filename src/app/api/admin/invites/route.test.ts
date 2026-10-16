import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/server/crypto/tokens";
import {
  adminContextAs,
  adminRequest,
  crossSiteRequest,
} from "@/test/admin-context-mock";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  adminInvite: vi.fn(),
  deliver: vi.fn(),
  displayName: vi.fn(async (): Promise<string | null> => "Mohamed"),
  schedule: vi.fn(),
}));
vi.mock("@/server/http/admin-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/http/admin-context")>()),
  loadAdminContext: mocks.context,
}));
vi.mock("@/server/queries/admin", () => ({ adminInvite: mocks.adminInvite }));
vi.mock("@/server/admin/deliver-admin-invite", () => ({
  deliverAdminInvite: mocks.deliver,
}));
vi.mock("@/server/queries/profile", () => ({
  getDisplayName: mocks.displayName,
}));
vi.mock("@/server/workers/schedule-workers", () => ({
  scheduleWorkers: mocks.schedule,
}));

const { POST } = await import("./route");
const body = { email: " New@Example.test ", delivery: "link" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(adminContextAs("owner"));
  mocks.adminInvite.mockResolvedValue({
    data: { id: "i1", expiresAt: "2026-10-23T09:00:00+00:00" },
    error: null,
  });
  mocks.deliver.mockResolvedValue({
    status: "link",
    link: "https://x/admin/join/t",
  });
});

describe("POST /api/admin/invites", () => {
  it("is the platform owner's; a bad address is 400", async () => {
    expect((await POST(crossSiteRequest("POST", body))).status).toBe(403);
    mocks.context.mockResolvedValueOnce(adminContextAs("signed_out"));
    expect((await POST(adminRequest("POST", undefined, body))).status).toBe(
      401,
    );
    mocks.context.mockResolvedValueOnce(adminContextAs("admin"));
    expect((await POST(adminRequest("POST", undefined, body))).status).toBe(
      404,
    );
    expect(
      (
        await POST(
          adminRequest("POST", undefined, { email: "nope", delivery: "email" }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.adminInvite).not.toHaveBeenCalled();
  });

  it("stores only the token's hash and hands the token to delivery", async () => {
    const response = await POST(adminRequest("POST", undefined, body));
    expect(await response.json()).toEqual({
      status: "link",
      link: "https://x/admin/join/t",
    });
    const [, email, tokenHash] = mocks.adminInvite.mock.calls[0];
    expect(email).toBe("new@example.test");
    const delivered = mocks.deliver.mock.calls[0][0];
    expect(sha256Hex(delivered.token)).toBe(tokenHash);
    expect(delivered).toMatchObject({
      email: "new@example.test",
      expiresAt: "2026-10-23T09:00:00+00:00",
      delivery: "link",
      origin: "http://localhost:3000",
      inviterName: "Mohamed",
    });
    expect(mocks.schedule).toHaveBeenCalledWith(["platform"]);
  });

  it("maps an existing admin to 409", async () => {
    mocks.adminInvite.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:already_member" },
    });
    expect((await POST(adminRequest("POST", undefined, body))).status).toBe(
      409,
    );
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
});
