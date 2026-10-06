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
});
