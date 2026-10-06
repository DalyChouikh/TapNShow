import { describe, expect, it } from "vitest";
import { tokenPageHeaders } from "./security-headers";

describe("tokenPageHeaders", () => {
  it("sends no referrer from pages whose URL carries a token", () => {
    const sources = tokenPageHeaders.map((rule) => rule.source);
    expect(sources).toEqual(["/invite/:token*", "/r/:token*"]);
    for (const rule of tokenPageHeaders) {
      expect(rule.headers).toContainEqual({
        key: "Referrer-Policy",
        value: "no-referrer",
      });
    }
  });
});
