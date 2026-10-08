import { describe, expect, it } from "vitest";
import {
  bulkContactsBodySchema,
  contactNameSchema,
  importBodySchema,
  listNameSchema,
  updateContactBodySchema,
} from "./roster";

describe("roster schemas", () => {
  it("trims names and enforces the database lengths", () => {
    expect(contactNameSchema.parse("  Inès  ")).toBe("Inès");
    // Same normalization as import_contacts, so an edited double space is not "updated" on re-import.
    expect(contactNameSchema.parse("Nour  Ben   Ali ")).toBe("Nour Ben Ali");
    expect(contactNameSchema.safeParse("   ").success).toBe(false);
    expect(contactNameSchema.safeParse("x".repeat(121)).success).toBe(false);
    expect(listNameSchema.safeParse("y".repeat(61)).success).toBe(false);
    expect(listNameSchema.safeParse("   ").success).toBe(false);
  });

  it("needs at least one field to update and normalizes the email", () => {
    expect(updateContactBodySchema.safeParse({}).success).toBe(false);
    expect(
      updateContactBodySchema.parse({ email: " Ines@Example.COM " }),
    ).toEqual({ email: "ines@example.com" });
  });

  it("accepts raw import cells and caps their size", () => {
    const row = {
      row: 2,
      fullName: "  messy  ",
      email: "not an email",
      lists: ["Dev"],
    };
    expect(importBodySchema.parse({ rows: [row], dryRun: true })).toEqual({
      rows: [row],
      dryRun: true,
    });
    expect(
      importBodySchema.safeParse({
        rows: [{ ...row, email: "x".repeat(501) }],
        dryRun: true,
      }).success,
    ).toBe(false);
    expect(
      importBodySchema.safeParse({ rows: [{ ...row, row: 0 }], dryRun: true })
        .success,
    ).toBe(false);
  });

  it("requires a list for list actions", () => {
    const ids = [crypto.randomUUID()];
    expect(
      bulkContactsBodySchema.safeParse({ action: "delete", contactIds: ids })
        .success,
    ).toBe(true);
    expect(
      bulkContactsBodySchema.safeParse({ action: "addToList", contactIds: ids })
        .success,
    ).toBe(false);
    expect(
      bulkContactsBodySchema.safeParse({ action: "delete", contactIds: [] })
        .success,
    ).toBe(false);
  });
});
