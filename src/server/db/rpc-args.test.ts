import { describe, expect, it } from "vitest";
import { sqlNullable } from "./rpc-args";

describe("sqlNullable", () => {
  it("keeps values and turns undefined into null", () => {
    expect(sqlNullable("x")).toBe("x");
    expect(sqlNullable<string>(undefined)).toBeNull();
    expect(sqlNullable<string[]>(null)).toBeNull();
  });
});
