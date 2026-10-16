import { describe, expect, it } from "vitest";
import {
  adminInviteBodySchema,
  adminOverviewSchema,
  adminWorkspaceRowSchema,
} from "./admin";

describe("admin schemas", () => {
  it("accepts an invite body, normalizing the email", () => {
    expect(
      adminInviteBodySchema.parse({
        email: " New@Example.com ",
        delivery: "email",
      }),
    ).toEqual({
      email: "new@example.com",
      delivery: "email",
    });
    expect(
      adminInviteBodySchema.safeParse({ email: "nope", delivery: "email" })
        .success,
    ).toBe(false);
  });

  it("parses a workspace row and an overview", () => {
    expect(
      adminWorkspaceRowSchema.parse({
        id: "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
        name: "Robotics Club",
        slug: "robotics-ab12",
        createdAt: "2026-10-02T10:00:00+00:00",
        ownerEmail: "a•••@gmail.com",
        team: 6,
        contacts: 74,
        meetings30d: 6,
        emails30d: 402,
        failed30d: 16,
        reports7d: 3,
        people7d: 74,
        suspended: true,
        sender: "active",
        sheet: "off",
      }).sender,
    ).toBe("active");
    expect(adminOverviewSchema.shape.current).toBeDefined();
  });
});
