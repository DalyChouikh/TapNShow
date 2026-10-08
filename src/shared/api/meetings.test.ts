import { describe, expect, it } from "vitest";
import {
  addPeopleBodySchema,
  meetingUrlSchema,
  updateMeetingBodySchema,
} from "./meetings";

describe("meeting schemas", () => {
  it("accepts only http(s) meeting links or none", () => {
    expect(meetingUrlSchema.parse("")).toBe("");
    expect(meetingUrlSchema.parse("https://meet.example.test/abc")).toBe(
      "https://meet.example.test/abc",
    );
    expect(meetingUrlSchema.safeParse("javascript:alert(1)").success).toBe(
      false,
    );
    expect(meetingUrlSchema.safeParse("ftp://x.test").success).toBe(false);
  });

  it("validates one step's fields at a time", () => {
    expect(updateMeetingBodySchema.safeParse({}).success).toBe(false);
    expect(updateMeetingBodySchema.parse({ title: "  Kickoff " })).toEqual({
      title: "Kickoff",
    });
    expect(
      updateMeetingBodySchema.safeParse({ startsAt: "tomorrow" }).success,
    ).toBe(false);
    expect(
      updateMeetingBodySchema.parse({
        startsAt: "2026-10-09T17:00:00.000Z",
        responseDeadline: null,
      }),
    ).toEqual({
      startsAt: "2026-10-09T17:00:00.000Z",
      responseDeadline: null,
    });
  });

  it("normalizes added people and caps a save at 50", () => {
    expect(
      addPeopleBodySchema.parse({
        people: [{ fullName: " Nour ", email: " Nour@Uni.TN " }],
        saveToRoster: true,
      }),
    ).toEqual({
      people: [{ fullName: "Nour", email: "nour@uni.tn" }],
      saveToRoster: true,
    });
    const many = Array.from({ length: 51 }, (_, n) => ({
      fullName: `P${n}`,
      email: `p${n}@x.test`,
    }));
    expect(
      addPeopleBodySchema.safeParse({ people: many, saveToRoster: true })
        .success,
    ).toBe(false);
  });
});

describe("online place", () => {
  it("trims the online place on meetings and workspace defaults; links stay http(s)", async () => {
    const { updateMeetingDefaultsBodySchema } =
      await import("./meeting-settings");
    expect(
      updateMeetingBodySchema.parse({ onlineText: " Club Discord " }),
    ).toEqual({
      onlineText: "Club Discord",
    });
    expect(
      updateMeetingDefaultsBodySchema.parse({
        onlineText: " Club Discord ",
        meetingUrl: "https://discord.gg/abc123",
      }),
    ).toEqual({
      onlineText: "Club Discord",
      meetingUrl: "https://discord.gg/abc123",
    });
    expect(
      updateMeetingDefaultsBodySchema.safeParse({
        meetingUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });
});
