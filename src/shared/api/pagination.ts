import { z } from "zod";
import {
  CURSOR_MAX_LENGTH,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
} from "@/config/pagination";

/** One page of a list endpoint: the rows and the cursor of the next page (null = the end). */
export type Page<T> = { items: T[]; nextCursor: string | null };

/** Response schema of a paged endpoint whose rows match `item`. */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

/** `?cursor=&limit=` of a paged endpoint (query-string values arrive as strings). */
export const pageQuerySchema = z.object({
  cursor: z.string().min(1).max(CURSOR_MAX_LENGTH).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGE_SIZE_MAX)
    .default(PAGE_SIZE_DEFAULT),
});
