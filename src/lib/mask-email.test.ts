import { describe, expect, it } from "vitest";
import { maskEmail } from "./mask-email";

describe("maskEmail", () => {
  it("keeps the first letter and the domain (the shape of private.mask_email)", () => {
    expect(maskEmail("mohamed@gmail.com")).toBe("m•••@gmail.com");
  });

  it("matches the SQL for an address without @ (split_part gives an empty domain)", () => {
    expect(maskEmail("nobody")).toBe("n•••@");
  });
});
