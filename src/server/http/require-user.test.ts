import { describe, expect, it } from "vitest";
import { requireUser, type ClaimsClient } from "./require-user";

function clientWith(
  result: Awaited<ReturnType<ClaimsClient["auth"]["getClaims"]>>,
): ClaimsClient {
  return { auth: { getClaims: async () => result } };
}

describe("requireUser", () => {
  it("returns the verified user id and email", async () => {
    const user = await requireUser(
      clientWith({
        data: { claims: { sub: "u1", email: "a@example.test" } },
        error: null,
      }),
    );
    expect(user).toEqual({ id: "u1", email: "a@example.test" });
  });

  it("returns null without valid claims", async () => {
    expect(
      await requireUser(
        clientWith({ data: null, error: { message: "invalid JWT" } }),
      ),
    ).toBeNull();
  });
});
