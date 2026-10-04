import { describe, expect, it } from "vitest";
import { APP_DESCRIPTION, APP_NAME } from "./app";

describe("app config", () => {
  it("exposes the product name", () => {
    expect(APP_NAME).toBe("TapNShow");
  });

  it("has a description without emojis", () => {
    expect(APP_DESCRIPTION).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
