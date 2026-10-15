import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("zod-jitless", () => {
  it("turns off Zod's eval probe, which the CSP reports", async () => {
    await import("./zod-jitless");
    expect(z.config().jitless).toBe(true);
  });
});
