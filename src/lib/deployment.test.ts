import { describe, expect, it } from "vitest";
import { isProductionDeployment } from "./deployment";

describe("isProductionDeployment", () => {
  it.each([
    ["production", true],
    ["preview", false],
    ["development", false],
    [undefined, false],
  ])("VERCEL_ENV=%s → %s", (env, expected) => {
    expect(isProductionDeployment(env)).toBe(expected);
  });
});
