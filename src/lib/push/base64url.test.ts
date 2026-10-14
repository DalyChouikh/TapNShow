import { describe, expect, it } from "vitest";
import { base64UrlToBytes } from "./base64url";

describe("base64UrlToBytes", () => {
  it("decodes base64url without padding, including - and _", () => {
    expect([...base64UrlToBytes("AQID")]).toEqual([1, 2, 3]);
    expect([...base64UrlToBytes("AQ")]).toEqual([1]);
    expect([...base64UrlToBytes("-_8")]).toEqual([251, 255]);
  });
});
