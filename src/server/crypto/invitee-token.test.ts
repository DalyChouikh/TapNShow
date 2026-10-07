import { describe, expect, it } from "vitest";
import { deriveInviteeToken, inviteeTokenHash } from "./invitee-token";

const secret = "s".repeat(43);

describe("invitee tokens", () => {
  it("derives the same 256-bit token for the same invitee and different ones otherwise", () => {
    const a = deriveInviteeToken(
      "11111111-1111-4111-8111-111111111111",
      secret,
    );
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      deriveInviteeToken("11111111-1111-4111-8111-111111111111", secret),
    ).toBe(a);
    expect(
      deriveInviteeToken("22222222-2222-4222-8222-222222222222", secret),
    ).not.toBe(a);
    expect(
      deriveInviteeToken(
        "11111111-1111-4111-8111-111111111111",
        "t".repeat(43),
      ),
    ).not.toBe(a);
  });

  it("stores only a SHA-256 hex hash", () => {
    expect(inviteeTokenHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
