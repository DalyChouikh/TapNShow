import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contactHref, LEGAL_LINKS } from "./legal";

describe("LEGAL_LINKS", () => {
  it.each(Object.entries(LEGAL_LINKS))(
    "%s points at a page that exists (%s)",
    (_name, path) => {
      expect(existsSync(join(process.cwd(), "src/app", path, "page.tsx"))).toBe(
        true,
      );
    },
  );

  it("builds the contact mail link", () => {
    expect(contactHref("team@example.com")).toBe("mailto:team@example.com");
  });
});
