import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  connectionAssociatedData,
  openSecret,
  parseEncryptionKey,
  sealSecret,
} from "./secret-box";

const key = randomBytes(32);
const aad = connectionAssociatedData("user-1", "sub-1");

describe("secret box", () => {
  it("round-trips with a fresh IV each time", () => {
    const a = sealSecret("1//refresh-token", key, aad);
    const b = sealSecret("1//refresh-token", key, aad);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
    expect(openSecret(a, key, aad)).toBe("1//refresh-token");
  });

  it("refuses other associated data, keys, versions and any flipped byte", () => {
    const sealed = sealSecret("secret", key, aad);
    expect(() =>
      openSecret(sealed, key, connectionAssociatedData("user-2", "sub-1")),
    ).toThrow();
    expect(() => openSecret(sealed, randomBytes(32), aad)).toThrow();
    expect(() => openSecret(sealed.replace(/^v1/, "v2"), key, aad)).toThrow();
    const [version, iv, body, tag] = sealed.split(".");
    const flipped = Buffer.from(body, "base64url");
    flipped[0] ^= 1;
    expect(() =>
      openSecret(
        [version, iv, flipped.toString("base64url"), tag].join("."),
        key,
        aad,
      ),
    ).toThrow();
    expect(() =>
      openSecret([version, iv, body, tag.slice(0, 8)].join("."), key, aad),
    ).toThrow();
  });

  it("accepts only a 32-byte base64 key", () => {
    expect(parseEncryptionKey(randomBytes(32).toString("base64"))).toHaveLength(
      32,
    );
    expect(() =>
      parseEncryptionKey(randomBytes(16).toString("base64")),
    ).toThrow(/32 bytes/);
  });
});
