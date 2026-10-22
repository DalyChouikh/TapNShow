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
  const section = (id: string) =>
    privacyPolicy.sections.find((candidate) => candidate.id === id)?.body ?? "";

  it("says with whom Google data is shared, right after what Google data is used for (Google's review, 2026-10-20)", () => {
    const ids = privacyPolicy.sections.map((candidate) => candidate.id);
    expect(ids.indexOf("google-sharing")).toBe(ids.indexOf("google") + 1);
    const body = section("google-sharing");
    expect(body).toContain(
      "We don't sell, rent or trade Google data, and we don't transfer or disclose it to anyone else, except:",
    );
    for (const recipient of [
      "**People in your groups:**",
      "**Our team:**",
      "**The services that run TapNShow:**",
      "**Google:**",
      "**When the law requires it:**",
      "**A new owner:**",
    ]) {
      expect(body).toContain(recipient);
    }
  });

  it("affirms that Google Workspace data never trains AI or ML models", () => {
    expect(section("google")).toContain(
      "TapNShow does not use Google Workspace APIs (Gmail, Google Drive, Google Sheets), or any data received from them, to develop, improve or train AI or ML models, personalized or not.",
    );
  });

  it("says how long a Google connection is kept and that Google is asked to remove access", () => {
    expect(section("retention")).toContain(
      "- Gmail and Google Sheets connections: until no workspace uses them any more. We then delete them and ask Google to remove TapNShow's access, unless someone else still uses that Google account in TapNShow.",
    );
  });

  it("says the Google Sheet is shared with the team, view only, and how long that lasts (#413)", () => {
    expect(section("google")).toContain(
      "- **Files TapNShow creates (drive.file):** to create and update the one Google Sheet that follows a workspace's answers, and to share it, view only, with the workspace's team (Owner, Admins, Viewers); Google emails each of them a link.",
    );
    expect(section("google-sharing")).toContain(
      "TapNShow shares the group's Google Sheet with the team, view only.",
    );
    expect(section("visibility")).toContain(
      "TapNShow shares it, view only, with the group's team, who already see those in TapNShow.",
    );
    expect(section("retention")).toContain(
      "- A Google Sheet's sharing with a team member: until they leave the team, the sheet is turned off or replaced, or the workspace is deleted.",
    );
  });

  it("states that Google data follows the Limited Use requirements", () => {
    const text = JSON.stringify(privacyPolicy);
    expect(text).toContain(
      "TapNShow's use and transfer to any other app of information received from Google APIs will adhere to [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.",
    );
  });
});
