import { describe, expect, it } from "vitest";
import { INVITE_BATCH_MAX } from "@/config/invites";
import { createInviteBodySchema, inviteTokenBodySchema } from "./invites";

describe("invite contracts", () => {
  it("normalizes and de-duplicates the invited emails and refuses the owner role", () => {
    expect(
      createInviteBodySchema.parse({
        emails: [" Ali.Ben@Gmail.COM ", "ali.ben@gmail.com", "sami@x.test"],
        role: "viewer",
        delivery: "link",
      }).emails,
    ).toEqual(["ali.ben@gmail.com", "sami@x.test"]);
    expect(
      createInviteBodySchema.safeParse({
        emails: ["a@example.test"],
        role: "owner",
        delivery: "link",
      }).success,
    ).toBe(false);
  });

  it("needs 1 to INVITE_BATCH_MAX valid addresses", () => {
    expect(
      createInviteBodySchema.safeParse({
        emails: [],
        role: "viewer",
        delivery: "email",
      }).success,
    ).toBe(false);
    expect(
      createInviteBodySchema.safeParse({
        emails: ["nope"],
        role: "viewer",
        delivery: "email",
      }).success,
    ).toBe(false);
    const many = Array.from(
      { length: INVITE_BATCH_MAX + 1 },
      (_, index) => `p${index}@x.test`,
    );
    expect(
      createInviteBodySchema.safeParse({
        emails: many,
        role: "viewer",
        delivery: "email",
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
