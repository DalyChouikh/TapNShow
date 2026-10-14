import { describe, expect, it } from "vitest";
import { deleteAccountBodySchema } from "./account";

describe("deleteAccountBodySchema", () => {
  it("accepts only the exact word", () => {
    expect(
      deleteAccountBodySchema.safeParse({ confirm: "confirm" }).success,
    ).toBe(true);
    for (const body of [{ confirm: "Confirm" }, { confirm: " confirm" }, {}]) {
      expect(deleteAccountBodySchema.safeParse(body).success).toBe(false);
    }
  });
});
