import { describe, expect, it } from "vitest";
import { myInviteLinkSchema, myInvitesQuerySchema } from "./my-invites";

describe("member invites schemas", () => {
  it("defaults to Upcoming, All and refuses the needs filter on Past", () => {
    expect(myInvitesQuerySchema.parse({})).toEqual({
      tab: "upcoming",
      filter: "all",
    });
    expect(
      myInvitesQuerySchema.safeParse({ tab: "past", filter: "needs" }).success,
    ).toBe(false);
  });

  it("accepts only an answer-page path as a link", () => {
    expect(
      myInviteLinkSchema.safeParse({ path: `/r/${"a".repeat(43)}` }).success,
    ).toBe(true);
    expect(
      myInviteLinkSchema.safeParse({ path: "https://evil.example/r/x" })
        .success,
    ).toBe(false);
  });
});
