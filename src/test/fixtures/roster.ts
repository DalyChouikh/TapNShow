import type { ImportResult, Roster } from "@/shared/api/roster";

/** Stable ids for UI and cache tests. */
export const IDS = {
  ines: "00000000-0000-4000-8000-000000000001",
  youssef: "00000000-0000-4000-8000-000000000002",
  sarra: "00000000-0000-4000-8000-000000000003",
  dev: "00000000-0000-4000-8000-0000000000d1",
  design: "00000000-0000-4000-8000-0000000000d2",
} as const;

/** A small roster: two lists, three people. */
export const rosterFixture: Roster = {
  contacts: [
    {
      id: IDS.ines,
      email: "ines@example.com",
      fullName: "Inès Ben Salah",
      listIds: [IDS.dev],
    },
    {
      id: IDS.sarra,
      email: "sarra@example.com",
      fullName: "Sarra Khelifi",
      listIds: [IDS.dev, IDS.design],
    },
    {
      id: IDS.youssef,
      email: "y@example.com",
      fullName: "Youssef Trabelsi",
      listIds: [],
    },
  ],
  lists: [
    { id: IDS.design, name: "Design", contactCount: 1 },
    { id: IDS.dev, name: "Dev", contactCount: 2 },
  ],
  limits: { contactsMax: 2000, listsMax: 50, importRowsMax: 2000 },
};

/** A preview with one row of each kind. */
export const importPreviewFixture: ImportResult = {
  summary: { new: 1, updated: 1, unchanged: 1, invalid: 1, merged: 1 },
  newLists: ["Events"],
  limitExceeded: null,
  rows: [
    {
      row: 2,
      email: "amira@example.com",
      fullName: "Amira",
      outcome: "new",
      reason: null,
      addedLists: ["Events"],
      previousName: null,
      mergedRows: [9],
    },
    {
      row: 3,
      email: "y@example.com",
      fullName: "Youssef T.",
      outcome: "updated",
      reason: null,
      addedLists: [],
      previousName: "Youssef Trabelsi",
      mergedRows: [],
    },
    {
      row: 4,
      email: "ines@example.com",
      fullName: "Inès Ben Salah",
      outcome: "unchanged",
      reason: null,
      addedLists: [],
      previousName: null,
      mergedRows: [],
    },
    {
      row: 5,
      email: "mehdi.g@gmail",
      fullName: "Mehdi",
      outcome: "invalid",
      reason: "email_invalid",
      addedLists: [],
      previousName: null,
      mergedRows: [],
    },
  ],
};
