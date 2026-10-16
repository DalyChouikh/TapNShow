import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/server/crypto/tokens";
import {
  adminContextAs,
  adminRequest,
  crossSiteRequest,
  params,
} from "@/test/admin-context-mock";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  adminInviteRenew: vi.fn(),
  deliver: vi.fn(),
  displayName: vi.fn(async (): Promise<string | null> => "Mohamed"),
}));
vi.mock("@/server/http/admin-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/http/admin-context")>()),
  loadAdminContext: mocks.context,
}));
vi.mock("@/server/queries/admin", () => ({
  adminInviteRenew: mocks.adminInviteRenew,
}));
vi.mock("@/server/admin/deliver-admin-invite", () => ({
  deliverAdminInvite: mocks.deliver,
}));
vi.mock("@/server/queries/profile", () => ({
  getDisplayName: mocks.displayName,
}));

const { POST } = await import("./route");
const ID = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ctx = params({ id: ID });
const body = { delivery: "email" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(adminContextAs("owner"));
  mocks.adminInviteRenew.mockResolvedValue({
    data: {
      id: ID,
      email: "new@example.test",
      expiresAt: "2026-10-23T09:00:00+00:00",
    },
    error: null,
  });
  mocks.deliver.mockResolvedValue({ status: "sent" });
});

describe("POST /api/admin/invites/[id]/renew", () => {
  it("is the platform owner's; a bad body is 400", async () => {
    expect((await POST(crossSiteRequest("POST", body), ctx)).status).toBe(403);
    mocks.context.mockResolvedValueOnce(adminContextAs("admin"));
    expect(
      (await POST(adminRequest("POST", undefined, body), ctx)).status,
    ).toBe(404);
    expect(
      (await POST(adminRequest("POST", undefined, { delivery: "fax" }), ctx))
        .status,
    ).toBe(400);
  });

  it("stores a fresh token's hash and emails the invited address again", async () => {
    expect(
      await (await POST(adminRequest("POST", undefined, body), ctx)).json(),
    ).toEqual({
      status: "sent",
    });
    const [, id, tokenHash] = mocks.adminInviteRenew.mock.calls[0];
    expect(id).toBe(ID);
    const delivered = mocks.deliver.mock.calls[0][0];
    expect(sha256Hex(delivered.token)).toBe(tokenHash);
    expect(delivered).toMatchObject({
      email: "new@example.test",
      delivery: "email",
    });
  });

  it("maps a closed invite to 409", async () => {
    mocks.adminInviteRenew.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:invite_closed" },
    });
    expect(
      (await POST(adminRequest("POST", undefined, body), ctx)).status,
    ).toBe(409);
  });
});
