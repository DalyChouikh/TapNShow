import { describe, expect, it } from "vitest";
import { cp1252Bytes } from "@/test/fixtures/xlsx";
import { decodeText } from "./decode-text";
import { parseDelimited, parsePaste } from "./parse-delimited";

describe("parseDelimited", () => {
  it("detects ';' in a French Excel CSV and keeps blank lines for row numbers", () => {
    const text = decodeText(
      cp1252Bytes(
        "Nom;E-mail;Équipe\r\nInès Ben Salah;ines@example.com;Dev, Events\r\n\r\nYoussef;y@example.com;Design\r\n",
      ),
    );
    expect(parseDelimited(text)).toEqual([
      ["Nom", "E-mail", "Équipe"],
      ["Inès Ben Salah", "ines@example.com", "Dev, Events"],
      [""],
      ["Youssef", "y@example.com", "Design"],
      [""],
    ]);
  });

  it("keeps quoted commas and cleans cells", () => {
    expect(
      parseDelimited(
        'Full name,Email\n"Ben Salah, Inès", INES@Example.com \n',
      )[1],
    ).toEqual(["Ben Salah, Inès", "INES@Example.com"]);
  });
});

describe("parsePaste", () => {
  it("splits Google Sheets / Excel pastes on tabs", () => {
    expect(
      parsePaste("Prénom\tNom\tEmail\nInès\tBen Salah\tines@example.com"),
    ).toEqual([
      ["Prénom", "Nom", "Email"],
      ["Inès", "Ben Salah", "ines@example.com"],
    ]);
  });

  it("treats a pasted column of addresses as one column", () => {
    expect(parsePaste("a@example.com\nb@example.com")).toEqual([
      ["a@example.com"],
      ["b@example.com"],
    ]);
  });
});
