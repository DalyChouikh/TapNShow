import { adminClient } from "./clients";

const CHUNK = 500;

/**
 * Inserts `count` contacts named "<prefix> 1…n" with addresses `<prefix>-<n>@example.test` (service
 * role, bypasses RLS; the cap trigger still runs). Returns their ids in insertion order.
 */
export async function seedContacts(
  workspaceId: string,
  count: number,
  prefix = "member",
): Promise<string[]> {
  const ids: string[] = [];
  for (let start = 0; start < count; start += CHUNK) {
    const rows = Array.from(
      { length: Math.min(CHUNK, count - start) },
      (_, offset) => {
        const n = start + offset + 1;
        return {
          workspace_id: workspaceId,
          email: `${prefix}-${n}@example.test`,
          full_name: `${prefix} ${n}`,
        };
      },
    );
    const { data, error } = await adminClient()
      .from("contacts")
      .insert(rows)
      .select("id");
    if (error) {
      throw error;
    }
    ids.push(...data.map((row) => row.id));
  }
  return ids;
}

/** Creates a list (service role) and returns its id. */
export async function seedList(
  workspaceId: string,
  name: string,
): Promise<string> {
  const { data, error } = await adminClient()
    .from("lists")
    .insert({ workspace_id: workspaceId, name })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  return data.id;
}
