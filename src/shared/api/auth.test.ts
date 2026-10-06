import { describe, expect, it } from "vitest";
import {
  normalizeOtpCode,
  otpSendBodySchema,
  otpVerifyBodySchema,
} from "./auth";

describe("normalizeOtpCode", () => {
  it.each(["12345678", "1234 5678", "1234-5678", " 1234 5678 \n"])(
    "accepts %j",
    (raw) => {
      expect(normalizeOtpCode(raw)).toBe("12345678");
    },
  );
});

describe("otpVerifyBodySchema", () => {
  it("normalizes email and code", () => {
    expect(
      otpVerifyBodySchema.parse({
        email: " Ali@Example.TEST ",
        code: "1234 5678",
      }),
    ).toEqual({ email: "ali@example.test", code: "12345678" });
  });

  it("rejects codes with the wrong length or letters", () => {
    for (const code of ["1234567", "123456789", "1234abcd"]) {
      expect(
        otpVerifyBodySchema.safeParse({ email: "a@example.test", code })
          .success,
      ).toBe(false);
    }
  });
});

describe("otpSendBodySchema", () => {
  it("rejects invalid emails", () => {
    expect(otpSendBodySchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});
