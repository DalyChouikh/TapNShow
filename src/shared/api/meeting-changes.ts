import { z } from "zod";

/** One side of a change as the database writes it (`to_jsonb` of the column). */
export const changeValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
/** One side of a change. */
export type ChangeValue = z.infer<typeof changeValueSchema>;

/** `{ column: [old, new] }` (spec §6 `meeting_changes.changes`, `update` job payloads). */
export const changeSetSchema = z.record(
  z.string(),
  z.tuple([changeValueSchema, changeValueSchema]),
);
/** A set of field changes. */
export type ChangeSet = z.infer<typeof changeSetSchema>;
