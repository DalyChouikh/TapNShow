import { z } from "zod";

/** Body of mutations that return nothing else. */
export const okSchema = z.object({ ok: z.literal(true) });

/** Email as stored everywhere: trimmed and lower-cased (spec §6). */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email());
