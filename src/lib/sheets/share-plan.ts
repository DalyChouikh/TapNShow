import type { SheetShareReason, SheetShareState } from "@/shared/api/sheets";

/** A team member the sheet should be shared with (`private.sheet_share_targets`). */
export type ShareTarget = { userId: string; email: string; position: number };

/** What TapNShow recorded about one person's share (`sheet_shares`). */
export type ShareRow = {
  email: string;
  state: SheetShareState;
  permissionId: string | null;
  reason: SheetShareReason | null;
  nextTryAt: string | null;
};

/** One person Drive lists on the file (`permissions.list`, user permissions only). */
export type DrivePermission = { id: string; email: string };

/** What a share run does, person by person (design §5). */
export type SharePlan = {
  create: ShareTarget[];
  adopt: Array<{ target: ShareTarget; permissionId: string }>;
  external: ShareTarget[];
  removedInDrive: ShareTarget[];
  tooMany: ShareTarget[];
  remove: Array<{ email: string; permissionId: string }>;
  forget: string[];
  /** When the sheet's shares are due again: now when work was deferred, a refusal's retry time, or never. */
  nextDue: string | null;
};

const keyOf = (email: string) => email.toLowerCase();

/**
 * TapNShow asked Google to share with this address, or took the share as its own. A refusal counts:
 * Drive's `invalidSharingRequest` also covers "the items were successfully shared but emails could
 * not be sent" (Drive "Resolve errors", read 2026-10-20). Past the cap (`too_many`) it never tried.
 */
const triedByTapNShow = (row: ShareRow) =>
  row.state === "shared" ||
  row.state === "sharing" ||
  (row.state === "refused" && row.reason !== "too_many");

/**
 * Decides every person's share from the wanted team, TapNShow's records and what Drive lists
 * (design §5, the plan's Task 3 table). Never shares an address Drive already lists (Google would
 * email the person again), never removes a share TapNShow didn't make, and never shares again what
 * was removed by hand in Drive. Creates stop at `cap` (people past it are `tooMany`) and at
 * `createBudget` per run (the rest waits for the next run).
 */
export function planShareChanges(input: {
  targets: ShareTarget[];
  shares: ShareRow[];
  permissions: DrivePermission[];
  cap: number;
  now: number;
  createBudget: number;
}): SharePlan {
  const ids = new Set(input.permissions.map((permission) => permission.id));
  const byEmail = new Map(
    input.permissions.map((permission) => [
      keyOf(permission.email),
      permission.id,
    ]),
  );
  /** Drive may list an account under another address than the one used here: TapNShow's own share by its id first. */
  const listedFor = (email: string, row: ShareRow | undefined) =>
    row?.permissionId && ids.has(row.permissionId)
      ? row.permissionId
      : byEmail.get(keyOf(email));
  const rows = new Map(input.shares.map((row) => [keyOf(row.email), row]));
  const wanted = new Set(input.targets.map((target) => keyOf(target.email)));
  const plan: SharePlan = {
    create: [],
    adopt: [],
    external: [],
    removedInDrive: [],
    tooMany: [],
    remove: [],
    forget: [],
    nextDue: null,
  };
  const waiting: number[] = [];
  const toCreate: ShareTarget[] = [];
  let holding = 0;

  for (const target of [...input.targets].sort(
    (a, b) => a.position - b.position,
  )) {
    const row = rows.get(keyOf(target.email));
    const permissionId = listedFor(target.email, row);
    if (permissionId !== undefined) {
      holding += 1;
      if (!row || !triedByTapNShow(row)) {
        // Never asked by TapNShow (an external row stays as it is): someone shared it by hand.
        if (row?.state !== "external") {
          plan.external.push(target);
        }
      } else if (!(
        row.state === "shared" && row.permissionId === permissionId
      )) {
        plan.adopt.push({ target, permissionId });
      }
      continue;
    }
    if (row?.state === "shared" || row?.state === "external") {
      plan.removedInDrive.push(target);
    } else if (
      row?.state === "refused" &&
      row.reason === "refused" &&
      row.nextTryAt !== null &&
      Date.parse(row.nextTryAt) > input.now
    ) {
      waiting.push(Date.parse(row.nextTryAt));
    } else if (!(
      row?.state === "refused" && row.reason === "removed_in_drive"
    )) {
      toCreate.push(target);
    }
  }

  let budget = input.createBudget;
  let deferred = false;
  for (const target of toCreate) {
    if (holding >= input.cap) {
      const row = rows.get(keyOf(target.email));
      if (!(row?.state === "refused" && row.reason === "too_many")) {
        plan.tooMany.push(target);
      }
    } else if (budget === 0) {
      deferred = true;
    } else {
      plan.create.push(target);
      holding += 1;
      budget -= 1;
    }
  }

  for (const row of input.shares) {
    if (wanted.has(keyOf(row.email))) {
      continue;
    }
    const permissionId = listedFor(row.email, row);
    if (permissionId !== undefined && triedByTapNShow(row)) {
      plan.remove.push({ email: row.email, permissionId });
    } else {
      plan.forget.push(row.email);
    }
  }

  plan.nextDue = deferred
    ? new Date(input.now).toISOString()
    : waiting.length > 0
      ? new Date(Math.min(...waiting)).toISOString()
      : null;
  return plan;
}
