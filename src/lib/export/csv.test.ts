import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("starts with a BOM, quotes commas and quotes, uses CRLF, escapes formulas", () => {
    const csv = toCsv(
      ["Name", "Reason"],
      [
        ["Amira", 'Bus, "late"'],
        ["Omar", "=1+1"],
      ],
    );
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe(
      '﻿Name,Reason\r\nAmira,"Bus, ""late"""\r\nOmar,\'=1+1\r\n',
    );
  });
});

describe("toCsv with tinted cells", () => {
  it("writes only their text, still formula-safe", () => {
    expect(toCsv(["Answer"], [[{ text: "=Going", tone: "success" }]])).toBe(
      "﻿Answer\r\n'=Going\r\n",
    );
  });
});
