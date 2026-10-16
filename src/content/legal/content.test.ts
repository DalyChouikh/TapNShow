import { describe, expect, it } from "vitest";
import { privacyPolicy } from "./privacy";
import { terms } from "./terms";

describe.each([
  ["privacy", privacyPolicy],
  ["terms", terms],
])("%s", (_name, document) => {
  it("has five 'In short' bullets, a valid date and unique section ids", () => {
    expect(document.summary).toHaveLength(5);
    expect(Number.isNaN(Date.parse(document.updated))).toBe(false);
    const ids = document.sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("never names GDG ISSAT and ends with Contact", () => {
    expect(JSON.stringify(document)).not.toMatch(/gdg|issat/i);
    expect(document.sections.at(-1)?.id).toBe("contact");
  });
});

describe("privacy policy", () => {
  it("states that Google data follows the Limited Use requirements", () => {
    const text = JSON.stringify(privacyPolicy);
    expect(text).toContain(
      "TapNShow's use and transfer to any other app of information received from Google APIs will adhere to [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.",
    );
  });
});
