/**
 * Passes SQL `null` for an RPC argument. `supabase gen types` never marks function arguments
 * nullable, but plpgsql functions here treat `null` as "leave unchanged" or "no value".
 * @param value - the argument, or `undefined`/`null` for SQL null
 * @returns the value typed as the generated argument type
 */
export function sqlNullable<T>(value: T | null | undefined): T {
  return (value ?? null) as T;
}
