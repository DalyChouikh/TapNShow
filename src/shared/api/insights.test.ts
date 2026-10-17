import { describe, expect, it } from "vitest";
import { INSIGHTS_CHART_MEETINGS, OFTEN_MISSING_PEOPLE } from "@/config/home";
import { insightsFixture } from "@/test/fixtures/insights";
import { workspaceInsightsSchema } from "./insights";

describe("workspaceInsightsSchema", () => {
  it("accepts the documented response and rejects negative counts or more than 12 chart entries or 3 people", () => {
    expect(workspaceInsightsSchema.parse(insightsFixture)).toEqual(
      insightsFixture,
    );
    expect(
      workspaceInsightsSchema.safeParse({
        ...insightsFixture,
        period: { ...insightsFixture.period, answeredBeforeStart: null },
      }).success,
    ).toBe(true);

    const [meeting] = insightsFixture.chart;
    const [person] = insightsFixture.oftenMissing;
    for (const broken of [
      { ...insightsFixture, roster: { ...insightsFixture.roster, lists: -1 } },
      {
        ...insightsFixture,
        period: { ...insightsFixture.period, answeredBeforeStart: 1.5 },
      },
      { ...insightsFixture, chart: [{ ...meeting, noReply: -1 }] },
      { ...insightsFixture, chart: [{ ...meeting, startsAt: "yesterday" }] },
      {
        ...insightsFixture,
        chart: Array.from(
          { length: INSIGHTS_CHART_MEETINGS + 1 },
          () => meeting,
        ),
      },
      {
        ...insightsFixture,
        oftenMissing: Array.from(
          { length: OFTEN_MISSING_PEOPLE + 1 },
          () => person,
        ),
      },
    ]) {
      expect(workspaceInsightsSchema.safeParse(broken).success).toBe(false);
    }
  });
});
