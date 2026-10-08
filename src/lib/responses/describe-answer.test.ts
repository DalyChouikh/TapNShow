import { describe, expect, it } from "vitest";
import { describeAnswer, type AnswerLabels } from "./describe-answer";

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
