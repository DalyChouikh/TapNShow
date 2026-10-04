import "server-only";
import { z } from "zod";
import { blankToUndefined, formatEnvError, type EnvSource } from "./env-utils";

const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

/** Server-only environment variables (secrets live here, never in PublicEnv). */
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Validates server environment variables.
 * @throws Error naming every invalid or missing variable
 */
export function parseServerEnv(source: EnvSource): ServerEnv {
  const result = serverEnvSchema.safeParse(blankToUndefined(source));
  if (!result.success) {
    throw new Error(formatEnvError(result.error));
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/** Returns the validated server env, parsing `process.env` once per process. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
