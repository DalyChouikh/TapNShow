import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectionAssociatedData,
  sealSecret,
} from "@/server/crypto/secret-box";

const KEY = randomBytes(32);
const USER = "00000000-0000-4000-8000-000000000001";
const mocks = vi.hoisted(() => ({ revoke: vi.fn(async () => true) }));
vi.mock("@/config/env", () => ({
  getServerEnv: () => ({
    GOOGLE_TOKEN_ENCRYPTION_KEY: KEY.toString("base64"),
    LOG_LEVEL: "info",
  }),
}));
vi.mock("@/server/google/google-oauth", () => ({
  revokeGoogleToken: mocks.revoke,
}));

const { releasedSchema, revokeReleased } = await import("./release");

beforeEach(() => vi.clearAllMocks());

describe("revokeReleased", () => {
  it("opens each released token with its own owner and account, and revokes it", async () => {
    const sealed = sealSecret(
      "1//rt",
      KEY,
      connectionAssociatedData(USER, "g-1"),
    );
    const released = releasedSchema.parse({
      refresh_token_encrypted: sealed,
      google_sub: "g-1",
      user_id: USER,
    });
    await revokeReleased([released, null]);
    expect(mocks.revoke).toHaveBeenCalledWith("1//rt");
    expect(mocks.revoke).toHaveBeenCalledTimes(1);
  });

  it("never throws, even when a token can't be opened", async () => {
    await expect(
      revokeReleased([
        { tokenEncrypted: "v1.bad.bad.bad", googleSub: "g", userId: USER },
      ]),
    ).resolves.toBeUndefined();
  });
});
