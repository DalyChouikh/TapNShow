import "server-only";
import pino, { type DestinationStream, type Logger } from "pino";
import { APP_NAME } from "@/config/app";
import { getServerEnv, type ServerEnv } from "@/config/env";

/** Log levels accepted by the logger (mirrors `LOG_LEVEL`). */
export type LogLevel = ServerEnv["LOG_LEVEL"];

/** Object paths whose values are replaced with "[REDACTED]" before writing. */
export const REDACT_PATHS = [
  "token",
  "*.token",
  "refreshToken",
  "*.refreshToken",
  "secret",
  "*.secret",
  "password",
  "*.password",
  "authorization",
  "headers.authorization",
  "headers.cookie",
  "*.headers.authorization",
  "*.headers.cookie",
] as const;

/**
 * Creates a structured JSON logger with secret redaction.
 * @param options.level - minimum level to write
 * @param options.destination - optional stream (tests); defaults to stdout
 */
export function createLogger(options: {
  level: LogLevel;
  destination?: DestinationStream;
}): Logger {
  return pino(
    {
      level: options.level,
      base: { app: APP_NAME },
      redact: { paths: [...REDACT_PATHS], censor: "[REDACTED]" },
    },
    options.destination,
  );
}

/** Application-wide server logger. Use instead of `console.*`. */
export const logger: Logger = createLogger({
  level: getServerEnv().LOG_LEVEL,
});
