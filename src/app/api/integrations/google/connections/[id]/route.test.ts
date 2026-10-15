import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectionAssociatedData,
  sealSecret,
} from "@/server/crypto/secret-box";
import { jsonRequest } from "@/test/workspace-context-mock";

const KEY = randomBytes(32);
const mocks = vi.hoisted(() => ({
  disconnect: vi.fn(),
  revoke: vi.fn(async () => true),
}));
vi.mock("@/config/env", () => ({
  getServerEnv: () => ({
    GOOGLE_TOKEN_ENCRYPTION_KEY: KEY.toString("base64"),
    LOG_LEVEL: "silent",
  }),
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => ({ id: "user-1", email: null }),
}));
vi.mock("@/server/queries/sender", () => ({
  disconnectGoogleConnection: mocks.disconnect,
}));
vi.mock("@/server/google/google-oauth", () => ({
  revokeGoogleToken: mocks.revoke,
}));

const ID = "3f1c2b8e-6a43-4f0e-9a51-1f2c3d4e5f60";
const ctx = { params: Promise.resolve({ id: ID }) };
beforeEach(() => vi.clearAllMocks());

const USER = "00000000-0000-4000-8000-000000000001";

describe("DELETE /api/integrations/google/connections/[id]", () => {
  it("revokes the token when the connection is released", async () => {
    mocks.disconnect.mockResolvedValueOnce({
      data: {
        released: {
          tokenEncrypted: sealSecret(
            "1//rt",
            KEY,
            connectionAssociatedData(USER, "g-1"),
          ),
          googleSub: "g-1",
          userId: USER,
        },
        sheetsKept: [],
      },
      error: null,
    });
    const { DELETE } = await import("./route");
    expect(await (await DELETE(jsonRequest("DELETE"), ctx)).json()).toEqual({
      ok: true,
    });
    expect(mocks.revoke).toHaveBeenCalledWith("1//rt");
  });

  it("keeps the token when a Google Sheet still uses the account", async () => {
    mocks.disconnect.mockResolvedValueOnce({
      data: { released: null, sheetsKept: ["Robotics Club"] },
      error: null,
    });
    const { DELETE } = await import("./route");
    expect((await DELETE(jsonRequest("DELETE"), ctx)).status).toBe(200);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("still succeeds when the token cannot be opened, and 404s for others' connections", async () => {
    mocks.disconnect.mockResolvedValueOnce({
      data: {
        released: {
          tokenEncrypted: "v1.x.y.z",
          googleSub: "g-1",
          userId: USER,
        },
        sheetsKept: [],
      },
      error: null,
    });
    const { DELETE } = await import("./route");
    expect((await DELETE(jsonRequest("DELETE"), ctx)).status).toBe(200);
    expect(mocks.revoke).not.toHaveBeenCalled();
    mocks.disconnect.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:not_found" },
    });
    expect((await DELETE(jsonRequest("DELETE"), ctx)).status).toBe(404);
  });
});
