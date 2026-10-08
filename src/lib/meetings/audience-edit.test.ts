import { describe, expect, it } from "vitest";
import { audienceFixture, MEETING_IDS } from "@/test/fixtures/meetings";
import type { Audience } from "@/shared/api/meetings";
import { audienceBodyOf, toggleList, togglePerson } from "./audience-edit";

const withAdded: Audience = {
  ...audienceFixture,
  people: [
    ...audienceFixture.people,
    {
      id: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
      fullName: "Nour H.",
      email: "nour@uni.tn",
      listIds: [],
      added: true,
      excluded: false,
      unsubscribed: false,
      reported: false,
      invited: false,
    },
  ],
};

describe("audience edits", () => {
  it("reads the current body back from the audience", () => {
    expect(audienceBodyOf(withAdded)).toEqual({
      listIds: [MEETING_IDS.members, MEETING_IDS.committee],
      include: ["6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa"],
      exclude: [],
    });
  });

  it("toggles a list", () => {
    expect(toggleList(withAdded, MEETING_IDS.committee).listIds).toEqual([
      MEETING_IDS.members,
    ]);
    expect(
      toggleList({ ...withAdded, listIds: [] }, MEETING_IDS.committee).listIds,
    ).toEqual([MEETING_IDS.committee]);
  });

  it("excludes a list member, un-adds an added-only person, and re-includes", () => {
    expect(togglePerson(withAdded, MEETING_IDS.amira, false).exclude).toEqual([
      MEETING_IDS.amira,
    ]);
    expect(
      togglePerson(withAdded, "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa", false)
        .include,
    ).toEqual([]);
    const excluded: Audience = {
      ...withAdded,
      people: withAdded.people.map((p) =>
        p.id === MEETING_IDS.amira ? { ...p, excluded: true } : p,
      ),
    };
    expect(togglePerson(excluded, MEETING_IDS.amira, true).exclude).toEqual([]);
  });
});
