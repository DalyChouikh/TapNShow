import { describe, expect, it } from "vitest";
import { createInviteBodySchema, inviteTokenBodySchema } from "./invites";

describe("invite contracts", () => {
  it("normalizes the invited email and refuses the owner role", () => {
    expect(
      createInviteBodySchema.parse({
        email: " Ali.Ben@Gmail.COM ",
        role: "viewer",
        delivery: "link",
      }).email,
    ).toBe("ali.ben@gmail.com");
    expect(
      createInviteBodySchema.safeParse({
        email: "a@example.test",
        role: "owner",
        delivery: "link",
      }).success,
    ).toBe(false);
  });

  it("accepts only 256-bit base64url tokens", () => {
    expect(
      inviteTokenBodySchema.safeParse({ token: "A".repeat(43) }).success,
    ).toBe(true);
    expect(inviteTokenBodySchema.safeParse({ token: "short" }).success).toBe(
      false,
    );
    expect(
      inviteTokenBodySchema.safeParse({ token: `${"A".repeat(42)}/` }).success,
    ).toBe(false);
  });
});
