import "server-only";
import pino, { type DestinationStream, type LogFn, type Logger } from "pino";
import { APP_NAME } from "@/config/app";
import { getServerEnv, type ServerEnv } from "@/config/env";
import { scrubDeep, scrubUrl } from "@/lib/observability/scrub";

/** Log levels accepted by the logger (mirrors `LOG_LEVEL`). */
export type LogLevel = ServerEnv["LOG_LEVEL"];

/**
 * Creates a structured JSON logger that shares Sentry's privacy rules (`scrub.ts`):
 * values under sensitive field names are redacted at any depth, and personal-link
 * tokens are scrubbed from fields, message strings and serialized errors. If scrubbing
 * a log object fails, the object is replaced instead of being written raw (fail closed).
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
      // `formatters.log` (below) already turns Errors into scrubbed plain objects; pino's
      // default `err` serializer runs afterwards and would overwrite `type`, so pass through.
      serializers: { err: (error: Record<string, string>) => error },
      formatters: {
        log: (object) => {
          try {
            return scrubDeep(object);
          } catch {
            return { scrubFailed: true };
          }
        },
      },
      hooks: {
        logMethod(inputArgs, method) {
          const scrubbed = inputArgs.map((arg) =>
            typeof arg === "string" ? scrubUrl(arg) : arg,
          ) as Parameters<LogFn>;
          return method.apply(this, scrubbed);
        },
      },
    },
    options.destination,
  );
}

/** Application-wide server logger. Use instead of `console.*`. */
export const logger: Logger = createLogger({
  level: getServerEnv().LOG_LEVEL,
});
