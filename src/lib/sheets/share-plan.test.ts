import { describe, expect, it } from "vitest";
import {
  type DrivePermission,
  planShareChanges,
  type ShareRow,
  type ShareTarget,
} from "./share-plan";

const NOW = Date.parse("2026-10-21T10:00:00.000Z");
const LATER = "2026-10-22T10:00:00.000Z";
const EARLIER = "2026-10-20T10:00:00.000Z";

const target = (email: string, position = 1): ShareTarget => ({
  userId: `u-${email}`,
  email,
  position,
});
const row = (email: string, over: Partial<ShareRow> = {}): ShareRow => ({
  email,
  state: "pending",
  permissionId: null,
  reason: null,
  nextTryAt: null,
  ...over,
});
const listed = (email: string, id = `p-${email}`): DrivePermission => ({
  id,
  email,
});

function plan(input: {
  targets?: ShareTarget[];
  shares?: ShareRow[];
  permissions?: DrivePermission[];
  cap?: number;
  createBudget?: number;
}) {
  return planShareChanges({
    targets: input.targets ?? [],
    shares: input.shares ?? [],
    permissions: input.permissions ?? [],
    cap: input.cap ?? 500,
    now: NOW,
    createBudget: input.createBudget ?? 25,
  });
}

const EMPTY = {
  create: [],
  adopt: [],
  external: [],
  removedInDrive: [],
  tooMany: [],
  remove: [],
  forget: [],
  nextDue: null,
};

describe("planShareChanges: wanted and listed", () => {
  it("keeps a share TapNShow holds", () => {
    const sara = target("sara@example.test");
    expect(
      plan({
        targets: [sara],
        shares: [row(sara.email, { state: "shared", permissionId: "p1" })],
        permissions: [listed(sara.email, "p1")],
      }),
    ).toEqual(EMPTY);
  });

  it("keeps a hand share as it is", () => {
    const sara = target("sara@example.test");
    expect(
      plan({
        targets: [sara],
        shares: [row(sara.email, { state: "external" })],
        permissions: [listed(sara.email)],
      }),
    ).toEqual(EMPTY);
  });

  it.each(["sharing", "refused"] as const)(
    "adopts the listed permission when TapNShow had tried this address (%s)",
    (state) => {
      const sara = target("sara@example.test");
      expect(
        plan({
          targets: [sara],
          shares: [
            row(sara.email, {
              state,
              reason: state === "refused" ? "refused" : null,
            }),
          ],
          permissions: [listed(sara.email, "p9")],
        }),
      ).toEqual({ ...EMPTY, adopt: [{ target: sara, permissionId: "p9" }] });
    },
  );

  it("adopts the listed id when TapNShow's share now has another id", () => {
    const sara = target("sara@example.test");
    expect(
      plan({
        targets: [sara],
        shares: [row(sara.email, { state: "shared", permissionId: "old" })],
        permissions: [listed(sara.email, "new")],
      }).adopt,
    ).toEqual([{ target: sara, permissionId: "new" }]);
  });

  it.each([
    ["no row", []],
    ["a pending row", [row("sara@example.test")]],
  ] as const)(
    "records a hand share made before TapNShow (%s)",
    (_name, shares) => {
      const sara = target("sara@example.test");
      expect(
        plan({
          targets: [sara],
          shares: [...shares],
          permissions: [listed(sara.email)],
        }),
      ).toEqual({ ...EMPTY, external: [sara] });
    },
  );
});

describe("planShareChanges: wanted and not listed", () => {
  it.each(["shared", "external"] as const)(
    "never shares again when a %s permission was removed by hand in Drive",
    (state) => {
      const sara = target("sara@example.test");
      expect(
        plan({
          targets: [sara],
          shares: [
            row(sara.email, {
              state,
              permissionId: state === "shared" ? "p1" : null,
            }),
          ],
        }),
      ).toEqual({ ...EMPTY, removedInDrive: [sara] });
    },
  );

  it("leaves a person removed by hand alone", () => {
    const sara = target("sara@example.test");
    expect(
      plan({
        targets: [sara],
        shares: [
          row(sara.email, { state: "refused", reason: "removed_in_drive" }),
        ],
      }),
    ).toEqual(EMPTY);
  });

  it("tries a refusal again once its time has come", () => {
    const sara = target("sara@example.test");
    expect(
      plan({
        targets: [sara],
        shares: [
          row(sara.email, {
            state: "refused",
            reason: "refused",
            nextTryAt: EARLIER,
          }),
        ],
      }),
    ).toEqual({ ...EMPTY, create: [sara] });
  });

  it("waits for a refusal's time and says when", () => {
    const sara = target("sara@example.test");
    expect(
      plan({
        targets: [sara],
        shares: [
          row(sara.email, {
            state: "refused",
            reason: "refused",
            nextTryAt: LATER,
          }),
        ],
      }),
    ).toEqual({ ...EMPTY, nextDue: LATER });
  });

  it.each([
    ["no row", []],
    ["a pending row", [row("sara@example.test")]],
    [
      "an intent Google never carried out",
      [row("sara@example.test", { state: "sharing" })],
    ],
  ] as const)("shares with someone new (%s)", (_name, shares) => {
    const sara = target("sara@example.test");
    expect(plan({ targets: [sara], shares: [...shares] })).toEqual({
      ...EMPTY,
      create: [sara],
    });
  });
});

describe("planShareChanges: not wanted", () => {
  it.each(["shared", "sharing"] as const)(
    "removes TapNShow's own share (%s) of someone who left",
    (state) => {
      expect(
        plan({
          shares: [
            row("ali@example.test", {
              state,
              permissionId: state === "shared" ? "p1" : null,
            }),
          ],
          permissions: [listed("ali@example.test", "p1")],
        }),
      ).toEqual({
        ...EMPTY,
        remove: [{ email: "ali@example.test", permissionId: "p1" }],
      });
    },
  );

  it.each(["external", "refused", "pending"] as const)(
    "leaves a listed permission alone and forgets the %s row of someone who left",
    (state) => {
      expect(
        plan({
          shares: [row("ali@example.test", { state })],
          permissions: [listed("ali@example.test")],
        }),
      ).toEqual({ ...EMPTY, forget: ["ali@example.test"] });
    },
  );

  it("forgets anyone who left and isn't listed", () => {
    expect(
      plan({
        shares: [
          row("ali@example.test", { state: "shared", permissionId: "p1" }),
        ],
      }),
    ).toEqual({ ...EMPTY, forget: ["ali@example.test"] });
  });

  it("leaves a hand share of someone who isn't on the team alone", () => {
    expect(plan({ permissions: [listed("guest@example.test")] })).toEqual(
      EMPTY,
    );
  });
});

describe("planShareChanges: limits", () => {
  it("never creates for an address Google already lists", () => {
    const people = ["a", "b", "c"].map((n, i) =>
      target(`${n}@example.test`, i + 1),
    );
    const result = plan({
      targets: people,
      shares: [
        row("a@example.test", { state: "sharing" }),
        row("b@example.test", {
          state: "refused",
          reason: "refused",
          nextTryAt: EARLIER,
        }),
      ],
      permissions: people.map((p) => listed(p.email)),
    });
    expect(result.create).toEqual([]);
  });

  it("stops at the cap and marks the rest too many", () => {
    const people = ["a", "b", "c"].map((n, i) =>
      target(`${n}@example.test`, i + 1),
    );
    const result = plan({ targets: people, cap: 2 });
    expect(result.create).toEqual(people.slice(0, 2));
    expect(result.tooMany).toEqual([people[2]]);
  });

  it("counts shares already held against the cap", () => {
    const people = ["a", "b"].map((n, i) => target(`${n}@example.test`, i + 1));
    const result = plan({
      targets: people,
      shares: [row("a@example.test", { state: "shared", permissionId: "p1" })],
      permissions: [listed("a@example.test", "p1")],
      cap: 1,
    });
    expect(result.tooMany).toEqual([people[1]]);
  });

  it("shares someone marked too many once there is room", () => {
    const ali = target("ali@example.test");
    expect(
      plan({
        targets: [ali],
        shares: [row(ali.email, { state: "refused", reason: "too_many" })],
      }).create,
    ).toEqual([ali]);
  });

  it("defers creates past the run's budget and stays due", () => {
    const people = ["a", "b", "c"].map((n, i) =>
      target(`${n}@example.test`, i + 1),
    );
    const result = plan({ targets: people, createBudget: 1 });
    expect(result.create).toEqual([people[0]]);
    expect(result.tooMany).toEqual([]);
    expect(result.nextDue).toBe(new Date(NOW).toISOString());
  });

  it("compares addresses without case", () => {
    const sara = target("sara@example.test");
    expect(
      plan({
        targets: [sara],
        shares: [row(sara.email, { state: "shared", permissionId: "p1" })],
        permissions: [listed("Sara@Example.test", "p1")],
      }),
    ).toEqual(EMPTY);
  });
});
