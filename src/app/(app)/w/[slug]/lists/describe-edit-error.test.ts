import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api-client";
import { rosterFixture } from "@/test/fixtures/roster";
import { describeEditError } from "./describe-edit-error";

describe("describeEditError", () => {
  it("names who already uses the email", () => {
    expect(
      describeEditError(
        new ApiClientError("contact_email_taken", 409),
        "sarra@example.com",
        rosterFixture,
      ),
    ).toEqual({
      code: "contact_email_taken",
      takenBy: "Sarra Khelifi",
    });
  });

  it("falls back to the error code", () => {
    expect(
      describeEditError(
        new ApiClientError("forbidden", 403),
        undefined,
        rosterFixture,
      ),
    ).toEqual({ code: "forbidden", takenBy: null });
    expect(
      describeEditError(new Error("offline"), undefined, rosterFixture),
    ).toEqual({ code: "internal", takenBy: null });
  });
});
