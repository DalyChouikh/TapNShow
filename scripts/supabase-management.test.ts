import { describe, expect, it } from "vitest";
import { tnCode } from "./supabase-management";

describe("tnCode", () => {
  it("finds the database's tn: code in an error text, or nothing", () => {
    expect(
      tnCode(
        '{"error":{"message":"failed to execute query: error: tn:not_found"}}',
      ),
    ).toBe("tn:not_found");
    expect(tnCode("HTTP 500")).toBeUndefined();
  });
});
