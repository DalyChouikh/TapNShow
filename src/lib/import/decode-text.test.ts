import { describe, expect, it } from "vitest";
import { cp1252Bytes } from "@/test/fixtures/xlsx";
import { decodeText } from "./decode-text";

describe("decodeText", () => {
  it("reads UTF-8 and drops the byte-order mark", () => {
    expect(decodeText(new TextEncoder().encode("﻿Inès").buffer)).toBe("Inès");
  });

  it("falls back to Windows-1252 for French-locale Excel CSV (Review Focus 2)", () => {
    expect(decodeText(cp1252Bytes("Inès;Équipe"))).toBe("Inès;Équipe");
  });

  it("reads Excel's Unicode Text (UTF-16 with a byte-order mark)", () => {
    const text = "Full name\tEmail\r\nInès\tines@example.test";
    const little = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(text, "utf16le"),
    ]);
    expect(
      decodeText(
        little.buffer.slice(
          little.byteOffset,
          little.byteOffset + little.byteLength,
        ),
      ),
    ).toBe(text);
    const big = Buffer.from(little);
    big.swap16();
    expect(
      decodeText(
        big.buffer.slice(big.byteOffset, big.byteOffset + big.byteLength),
      ),
    ).toBe(text);
  });
});
