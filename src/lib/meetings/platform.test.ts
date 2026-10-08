import { describe, expect, it } from "vitest";
import { meetingPlatform } from "./platform";

describe("meetingPlatform", () => {
  it("names the common meeting apps from the link", () => {
    expect(meetingPlatform("https://discord.gg/abc123")).toBe("Discord");
    expect(meetingPlatform("https://discord.com/channels/1/2")).toBe("Discord");
    expect(meetingPlatform("https://meet.google.com/abc-defg-hij")).toBe(
      "Google Meet",
    );
    expect(meetingPlatform("https://us02web.zoom.us/j/123")).toBe("Zoom");
    expect(meetingPlatform("https://teams.microsoft.com/l/meetup-join/x")).toBe(
      "Microsoft Teams",
    );
    expect(meetingPlatform("https://teams.live.com/meet/1")).toBe(
      "Microsoft Teams",
    );
  });

  it("returns null for other or broken links, and for look-alike hosts", () => {
    expect(meetingPlatform("https://jitsi.example.test/room")).toBeNull();
    expect(meetingPlatform("")).toBeNull();
    expect(meetingPlatform("not a url")).toBeNull();
    expect(meetingPlatform("https://discord.gg.evil.test/x")).toBeNull();
    expect(meetingPlatform("https://notzoom.us/j/1")).toBeNull();
  });
});
