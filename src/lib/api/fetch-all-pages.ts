import type { z } from "zod";
import { PAGE_SIZE_MAX } from "@/config/pagination";
import { apiRequest } from "@/lib/api-client";
import type { Page } from "@/shared/api/pagination";

/** Every row of a paged endpoint, following `nextCursor` (exports and downloads only). */
export async function fetchAllPages<T>(
  path: string,
  params: Record<string, string>,
  schema: z.ZodType<Page<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({
      ...params,
      limit: String(PAGE_SIZE_MAX),
      ...(cursor ? { cursor } : {}),
    });
    const page: Page<T> = await apiRequest(`${path}?${query.toString()}`, {
      schema,
    });
    rows.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return rows;
}
