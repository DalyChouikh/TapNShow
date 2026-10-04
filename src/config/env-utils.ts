import { z } from "zod";

/** Raw environment variables as provided by the runtime. */
export type EnvSource = Record<string, string | undefined>;

/**
 * Treats empty-string variables as unset so optional values behave consistently
 * across Vercel, CI and local `.env` files.
 */
export function blankToUndefined(source: EnvSource): EnvSource {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key,
      value === "" ? undefined : value,
    ]),
  );
}

/** Builds a readable, variable-naming error message from a Zod failure. */
export function formatEnvError(error: z.ZodError): string {
  return `Invalid environment variables:\n${z.prettifyError(error)}`;
}
