import "server-only";
import pino, { type DestinationStream, type LogFn, type Logger } from "pino";
import { APP_NAME } from "@/config/app";
import { getServerEnv, type ServerEnv } from "@/config/env";
import { scrubDeep, scrubText } from "@/lib/observability/scrub";

/** Log levels accepted by the logger (mirrors `LOG_LEVEL`). */
export type LogLevel = ServerEnv["LOG_LEVEL"];

/** Written instead of a log line that could not be scrubbed (fail closed). */
const DROPPED_LINE = `${JSON.stringify({ level: 50, msg: "log line dropped: scrub failed" })}\n`;

/**
 * Final safety net: re-scrubs every finished JSON line structurally (parse → walk →
 * serialize) before it reaches the destination. Catches fields pino adds outside the
 * log formatter, such as child-logger bindings.
 */
function scrubbingStream(target: DestinationStream): DestinationStream {
  return {
    write(line: string) {
      try {
        target.write(`${JSON.stringify(scrubDeep(JSON.parse(line)))}\n`);
      } catch {
        target.write(DROPPED_LINE);
      }
    },
  };
}

/**
 * Creates a structured JSON logger that shares Sentry's privacy rules (`scrub.ts`):
 * values under sensitive field names are redacted at any depth, and personal-link
 * tokens and credential-shaped strings are scrubbed from fields, message strings, format
 * arguments and serialized errors, and every finished line is re-scrubbed before writing
 * (covers child-logger bindings). If scrubbing
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
          const scrubbed = inputArgs.map((arg) => {
            if (typeof arg === "string") return scrubText(arg);
            if (arg === null || typeof arg !== "object") return arg;
            try {
              return scrubDeep(arg);
            } catch {
              return { scrubFailed: true };
            }
          }) as Parameters<LogFn>;
          return method.apply(this, scrubbed);
        },
      },
    },
    scrubbingStream(options.destination ?? pino.destination(1)),
  );
}

/** Application-wide server logger. Use instead of `console.*`. */
export const logger: Logger = createLogger({
  level: getServerEnv().LOG_LEVEL,
});
