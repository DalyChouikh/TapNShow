import { describe, expect, it } from "vitest";
import { senderSettingsPath, withQuery } from "./with-query";

describe("withQuery", () => {
  it("adds or replaces a parameter and keeps the hash", () => {
    expect(withQuery("/w/club/settings#sending", "gmail", "connected")).toBe(
      "/w/club/settings?gmail=connected#sending",
    );
    expect(
      withQuery(
        "/w/club/meetings/1/edit?step=review&gmail_error=failed",
        "gmail_error",
        "cancelled",
      ),
    ).toBe("/w/club/meetings/1/edit?step=review&gmail_error=cancelled");
  });

  it("points the connect flow back at Settings > Sending", () => {
    expect(senderSettingsPath("club")).toBe("/w/club/settings#sending");
  });
});
