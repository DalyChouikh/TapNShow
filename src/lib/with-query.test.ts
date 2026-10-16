import { describe, expect, it } from "vitest";
import {
  resultPath,
  settingsPath,
  withQuery,
  workspaceHomePath,
} from "./with-query";

describe("withQuery", () => {
  it("adds or replaces a parameter and keeps the hash", () => {
    expect(withQuery("/w/club/settings#sending", "google", "connected")).toBe(
      "/w/club/settings?google=connected#sending",
    );
    expect(
      withQuery(
        "/w/club/meetings/1/edit?step=review&google_error=failed",
        "google_error",
        "cancelled",
      ),
    ).toBe("/w/club/meetings/1/edit?step=review&google_error=cancelled");
  });

  it("never turns a path into another site's address", () => {
    expect(withQuery("/w/../..//evil.example/x", "google", "1")).toBe("/");
    expect(settingsPath("../..//evil.example", "sheets")).toBe("/welcome");
  });
});

describe("settingsPath", () => {
  it("points the connect flow back at the right Settings section", () => {
    expect(settingsPath("club-ab12", "sending")).toBe(
      "/w/club-ab12/settings#sending",
    );
    expect(settingsPath("club-ab12", "sheets")).toBe(
      "/w/club-ab12/settings#sheets",
    );
  });
});

describe("resultPath", () => {
  it("adds the connect result and its purpose, keeping the hash", () => {
    expect(
      resultPath(
        "/w/club/settings#sheets",
        "sheets",
        "google_error",
        "rate_limited",
      ),
    ).toBe(
      "/w/club/settings?google_error=rate_limited&google_for=sheets#sheets",
    );
  });
});

describe("workspaceHomePath", () => {
  it("links a workspace's Home, never a crafted slug", () => {
    expect(workspaceHomePath("robotics-ab12")).toBe("/w/robotics-ab12");
    expect(workspaceHomePath("../..//evil.example")).toBe("/welcome");
  });
});
