import { overrideLimit } from "./outbox";
import { runLocalSql } from "./sql";

/**
 * Runs `fn` with one `private.app_limits` value changed (it must stay above 0, the table's check),
 * then restores it. DB tests run one file at a time, so no other test sees the change. Clears past
 * rate-limit events first, so earlier tests' spending doesn't count.
 */
export async function withLimit<T>(
  name: string,
  limit: number,
  fn: () => Promise<T>,
): Promise<T> {
  const restore = overrideLimit(name, limit);
  runLocalSql("delete from private.rate_limit_events");
  try {
    return await fn();
  } finally {
    restore();
  }
}
