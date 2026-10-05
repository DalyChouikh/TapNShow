import "server-only";

/**
 * The slice of a Supabase client this query needs. Route handlers adapt the real client;
 * tests pass a plain double without casts.
 */
export type HealthcheckClient = {
  rpc: (
    fn: "healthcheck",
  ) => PromiseLike<{ data: string | null; error: { message: string } | null }>;
};

/**
 * Reads the database clock through the `healthcheck()` function.
 * @throws Error with the database message when the call fails
 */
export async function getDatabaseTime(
  client: HealthcheckClient,
): Promise<string> {
  const { data, error } = await client.rpc("healthcheck");
  if (error || !data) {
    throw new Error(error?.message ?? "healthcheck returned no data");
  }
  return data;
}
