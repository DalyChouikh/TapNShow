import { describe, expect, it } from "vitest";
import { myInviteFixture } from "@/test/fixtures/my-invites";
import { describeInvite } from "./describe";

const base = myInviteFixture;

describe("describeInvite", () => {
  it("Upcoming: not answered, with the deadline when there is one", () => {
    expect(describeInvite(base, "upcoming")).toEqual([
      { key: "notAnswered", tone: "warning" },
    ]);
    expect(
      describeInvite(
        { ...base, responseDeadline: "2026-10-17T10:00:00.000Z" },
        "upcoming",
      ),
    ).toEqual([
      { key: "notAnswered", tone: "warning" },
      {
        key: "answerBy",
        tone: "neutral",
        values: { when: "Sat 17 Oct, 11:00" },
      },
    ]);
  });

  it("Upcoming: a time change asks to reconfirm; an answer shows in its tone", () => {
    const going = {
      status: "attending" as const,
      delayMinutes: null,
      reason: "",
      needsReconfirmation: false,
    };
    expect(
      describeInvite(
        { ...base, answer: { ...going, needsReconfirmation: true } },
        "upcoming",
      )[0],
    ).toEqual({
      key: "timeChanged",
      tone: "warning",
      values: { answer: "attending" },
    });
    expect(
      describeInvite(
        { ...base, needsAnswer: false, answer: going },
        "upcoming",
      ),
    ).toEqual([
      {
        key: "answer",
        tone: "success",
        values: { status: "attending", minutes: 0 },
      },
    ]);
  });

  it("cancelled and announcements say so and nothing else", () => {
    expect(
      describeInvite({ ...base, status: "cancelled" }, "upcoming"),
    ).toEqual([{ key: "cancelled", tone: "neutral" }]);
    expect(
      describeInvite({ ...base, responseMode: "announcement" }, "past"),
    ).toEqual([{ key: "noAnswerNeeded", tone: "neutral" }]);
  });

  it("Past: what they said next to the check-in", () => {
    expect(
      describeInvite(
        {
          ...base,
          answer: {
            status: "late",
            delayMinutes: 10,
            reason: "Bus",
            needsReconfirmation: false,
          },
          mark: { actual: "late", lateMinutes: 15 },
        },
        "past",
      ),
    ).toEqual([
      { key: "said", tone: "warning", values: { status: "late", minutes: 10 } },
      { key: "was", tone: "warning", values: { actual: "late", minutes: 15 } },
    ]);
    expect(
      describeInvite(
        { ...base, mark: { actual: "present", lateMinutes: null } },
        "past",
      ),
    ).toEqual([
      { key: "noAnswer", tone: "neutral" },
      {
        key: "was",
        tone: "success",
        values: { actual: "present", minutes: 0 },
      },
    ]);
  });
});
