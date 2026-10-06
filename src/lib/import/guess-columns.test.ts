import { describe, expect, it } from "vitest";
import { guessColumns, mappingProblem } from "./guess-columns";
import { parseDelimited, parsePaste } from "./parse-delimited";

describe("guessColumns", () => {
  it("matches English and French headers, accents and case ignored", () => {
    expect(
      guessColumns(
        parseDelimited("Nom complet;E-mail;Équipe;Year\nA;a@example.com;Dev;2"),
      ),
    ).toEqual({
      hasHeader: true,
      targets: ["fullName", "email", "lists", "ignore"],
    });
    expect(
      guessColumns(
        parseDelimited("Full Name,Email Address,Team\nA,a@example.com,Dev"),
      ).targets,
    ).toEqual(["fullName", "email", "lists"]);
  });

  it("maps separate first and last name columns both to Full name (Review Focus 3)", () => {
    expect(
      guessColumns(
        parsePaste(
          "Prénom\tNom\tEmail\tÉquipe\nInès\tBen Salah\tines@example.com\tDev",
        ),
      ).targets,
    ).toEqual(["fullName", "fullName", "email", "lists"]);
  });

  it("recognizes an email column by a header containing 'mail'", () => {
    expect(
      guessColumns(
        parseDelimited(
          "Nom complet,Adresse e-mail (ISSAT),Year\nA,a@example.com,2",
        ),
      ).targets,
    ).toEqual(["fullName", "email", "ignore"]);
  });

  it("detects a file without a header row from its data", () => {
    expect(
      guessColumns(
        parsePaste("ines@example.com\tInès\nsara@example.com\tSarra"),
      ),
    ).toEqual({
      hasHeader: false,
      targets: ["email", "fullName"],
    });
  });

  it("finds the email column by data when no header names it, and keeps only one", () => {
    expect(
      guessColumns(
        parseDelimited(
          "Who,Contact,Backup\nA,a@example.com,b@example.com\nB,c@example.com,",
        ),
      ).targets,
    ).toEqual(["ignore", "email", "ignore"]);
    expect(
      guessColumns(
        parseDelimited("Email,Mail\na@example.com,x\nb@example.com,y"),
      ).targets,
    ).toEqual(["email", "ignore"]);
  });
});

describe("mappingProblem", () => {
  it("needs exactly one email column", () => {
    expect(
      mappingProblem({ hasHeader: true, targets: ["fullName", "lists"] }),
    ).toBe("no_email");
    expect(
      mappingProblem({ hasHeader: true, targets: ["email", "email"] }),
    ).toBe("several_emails");
    expect(
      mappingProblem({ hasHeader: true, targets: ["fullName", "email"] }),
    ).toBeNull();
  });
});
