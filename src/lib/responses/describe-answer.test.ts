import { describe, expect, it } from "vitest";
import {
  describeAnswer,
  lowerFirst,
  type AnswerLabels,
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
