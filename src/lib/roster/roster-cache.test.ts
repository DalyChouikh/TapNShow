import { describe, expect, it } from "vitest";
import { IDS, rosterFixture } from "@/test/fixtures/roster";
import { addList, patchContact, removeContacts } from "./roster-cache";

describe("roster cache updaters", () => {
  it("patches one person and recounts lists when their lists change", () => {
    const next = patchContact(rosterFixture, IDS.youssef, {
      fullName: "Youssef T.",
      listIds: [IDS.design],
    });
    expect(next.contacts.find((c) => c.id === IDS.youssef)).toMatchObject({
      fullName: "Youssef T.",
      listIds: [IDS.design],
    });
    expect(next.lists).toEqual([
      { id: IDS.design, name: "Design", contactCount: 2 },
      { id: IDS.dev, name: "Dev", contactCount: 2 },
    ]);
    expect(
      rosterFixture.contacts.find((c) => c.id === IDS.youssef)?.fullName,
    ).toBe("Youssef Trabelsi");
  });

  it("re-sorts by name after a rename", () => {
    const next = patchContact(rosterFixture, IDS.youssef, {
      fullName: "Aaron",
    });
    expect(next.contacts[0].id).toBe(IDS.youssef);
  });

  it("removes people and recounts", () => {
    const next = removeContacts(rosterFixture, [IDS.sarra]);
    expect(next.contacts.map((c) => c.id)).toEqual([IDS.ines, IDS.youssef]);
    expect(next.lists.map((l) => l.contactCount)).toEqual([0, 1]);
  });

  it("adds a list in name order with no people", () => {
    const next = addList(rosterFixture, {
      id: "00000000-0000-4000-8000-0000000000d3",
      name: "alumni",
    });
    expect(next.lists.map((l) => l.name)).toEqual(["alumni", "Design", "Dev"]);
  });
});
