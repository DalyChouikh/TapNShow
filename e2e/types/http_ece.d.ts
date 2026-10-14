/** The part of `http_ece` the e2e fake push service uses (RFC 8188 / RFC 8291 decryption). */
declare module "http_ece" {
  import type { ECDH } from "node:crypto";

  /** Decrypts an `aes128gcm` Web Push body with the receiving browser's keys. */
  export function decrypt(
    buffer: Buffer,
    params: { version: "aes128gcm"; privateKey: ECDH; authSecret: string },
  ): Buffer;
}
