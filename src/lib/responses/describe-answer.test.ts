import { describe, expect, it } from "vitest";
import {
  type AnswerLabels,
  type CheckInWords,
  describeAnswer,
  describeCheckIn,
  lowerFirst,
} from "./describe-answer";

const labels: AnswerLabels = {
  attending: "Going",
  late: (minutes) => `Late by ${minutes} min`,
  absent: "Can't come",
  not_attending: "Not going",
};

describe("describeAnswer", () => {
  it("names each status, with the delay for Late", () => {
    expect(describeAnswer(labels, { status: "late", delayMinutes: 20 })).toBe(
      "Late by 20 min",
    );
    expect(
      describeAnswer(labels, { status: "attending", delayMinutes: null }),
    ).toBe("Going");
    expect(
      describeAnswer(labels, { status: "not_attending", delayMinutes: null }),
    ).toBe("Not going");
  });
});

describe("lowerFirst", () => {
  it("lower-cases only the first letter, for use inside a sentence", () => {
    expect(lowerFirst("Going")).toBe("going");
    expect(lowerFirst("Late by 10 min")).toBe("late by 10 min");
    expect(lowerFirst("")).toBe("");
  });
});

describe("describeCheckIn", () => {
  const words: CheckInWords = {
    noReply: "No reply",
    didntAnswer: "Didn't answer",
    said: (answer) => `Said ${answer}`,
    actual: (value) =>
      ({ present: "present", late: "late", absent: "absent" })[value],
    saidWas: (said, was) => `${said} · Was ${was}`,
  };
  const mark = (actual: "present" | "late" | "absent") => ({
    actual,
    markedAt: "2026-10-09T17:05:00.000Z",
    markedByName: "Daly",
  });
  const going = { status: "attending" as const, delayMinutes: null };

  it("says the answer alone without a check-in, or when they agree", () => {
    expect(describeCheckIn(labels, words, going, null)).toBe("Going");
    expect(describeCheckIn(labels, words, going, mark("present"))).toBe(
      "Going",
    );
    expect(describeCheckIn(labels, words, null, null)).toBe("No reply");
  });

  it("puts what they said next to what happened when they differ", () => {
    expect(describeCheckIn(labels, words, going, mark("absent"))).toBe(
      "Said going · Was absent",
    );
    expect(describeCheckIn(labels, words, null, mark("present"))).toBe(
      "Didn't answer · Was present",
    );
  });
});
