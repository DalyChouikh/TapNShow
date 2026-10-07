import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

/**
 * Decodes `GOOGLE_TOKEN_ENCRYPTION_KEY`.
 * @throws Error when it is not 32 bytes of base64
 */
export function parseEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be 32 bytes (base64)");
  }
  return key;
}

/** Associated data binding a sealed refresh token to its connection (user + Google account). */
export function connectionAssociatedData(
  userId: string,
  googleSub: string,
): string {
  return `google_connection:${userId}:${googleSub}`;
}

/** AES-256-GCM with a random 96-bit IV; output `v1.<iv>.<ciphertext>.<tag>` (base64url parts). */
export function sealSecret(
  plaintext: string,
  key: Buffer,
  associatedData: string,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

/**
 * Opens a value from `sealSecret`.
 * @throws Error on an unknown version, a wrong key or associated data, or any tampering
 */
export function openSecret(
  sealed: string,
  key: Buffer,
  associatedData: string,
): string {
  const [version, iv, ciphertext, tag, extra] = sealed.split(".");
  if (
    version !== VERSION ||
    !iv ||
    !ciphertext ||
    !tag ||
    extra !== undefined
  ) {
    throw new Error("Unsupported sealed secret");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "base64url"),
    {
      authTagLength: TAG_BYTES,
    },
  );
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
