import { z } from "zod";
import { OTP_LENGTH } from "@/config/auth";
import { emailSchema } from "./common";

/** Removes the spaces and dashes people paste along with the code. */
export function normalizeOtpCode(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

const otpCodeSchema = z
  .string()
  .transform(normalizeOtpCode)
  .pipe(z.string().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`)));

/** `POST /api/auth/otp/send` body. */
export const otpSendBodySchema = z.object({ email: emailSchema });

/** `POST /api/auth/otp/verify` body. */
export const otpVerifyBodySchema = z.object({
  email: emailSchema,
  code: otpCodeSchema,
});
