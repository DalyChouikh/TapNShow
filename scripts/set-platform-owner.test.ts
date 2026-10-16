import { describe, expect, it } from "vitest";
import { maskEmail, ownerSql, parseOwnerArgs } from "./set-platform-owner";

describe("set-platform-owner", () => {
  it("parses the email, the project and --replace", () => {
    expect(
      parseOwnerArgs([
        "--email",
        "Me@Example.com",
        "--project",
        "production",
        "--replace",
      ]),
    ).toEqual({
      email: "me@example.com",
      project: "production",
      replace: true,
    });
  });

  it("refuses a malformed email, an unknown project, and an email that could break out of the literal", () => {
    expect(() =>
      parseOwnerArgs(["--email", "nope", "--project", "local"]),
    ).toThrow(/email/);
    expect(() =>
      parseOwnerArgs(["--email", "a@b.co", "--project", "staging"]),
    ).toThrow(/project/);
    expect(() =>
      parseOwnerArgs(["--email", "a$tn$@b.co", "--project", "local"]),
    ).toThrow(/email/);
  });

  it("builds one dollar-quoted call", () => {
    expect(ownerSql("me@example.com", false)).toBe(
      "select private.set_platform_owner($tn$me@example.com$tn$, false) as result",
    );
  });

  it("masks the address in what it prints", () => {
    expect(maskEmail("mohamed@gmail.com")).toBe("m•••@gmail.com");
  });
});
