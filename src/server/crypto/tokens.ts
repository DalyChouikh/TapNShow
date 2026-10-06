import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Random URL-safe token (default 32 bytes = 256 bits). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256 as lowercase hex (stored token hashes, Google nonce). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** SHA-256 as base64url (PKCE `code_challenge`). */
export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

/** Constant-time string comparison. */
export function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
