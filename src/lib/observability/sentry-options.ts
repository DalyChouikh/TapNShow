import type {
  Breadcrumb,
  ErrorEvent,
  StreamedSpanJSON,
  TransactionEvent,
} from "@sentry/core";
import { REDACTED, scrubDeep, scrubHeaders } from "./scrub";

/** Sample rate for performance traces (free tier friendly). */
export const TRACES_SAMPLE_RATE = 0.1;

/** The subset of Sentry init options TapNShow controls. Returning null drops the payload. */
export type SentryOptions = {
  enabled: boolean;
  dsn?: string;
  environment: string;
  tracesSampleRate: number;
  sendDefaultPii: false;
  beforeSend: (event: ErrorEvent) => ErrorEvent | null;
  beforeSendTransaction: (event: TransactionEvent) => TransactionEvent | null;
  beforeBreadcrumb: (breadcrumb: Breadcrumb) => Breadcrumb | null;
  beforeSendSpan: (span: StreamedSpanJSON) => StreamedSpanJSON;
};

/**
 * Removes user data (IP, id), request cookies and body (bodies can contain absence
 * reasons), strips credential/referrer headers, then scrubs personal-link tokens from
 * every string.
 */
function sanitizeEvent<T extends ErrorEvent | TransactionEvent>(event: T): T {
  const request = event.request
    ? {
        ...event.request,
        cookies: undefined,
        data: undefined,
        headers: event.request.headers
          ? scrubHeaders(event.request.headers)
          : undefined,
      }
    : undefined;
  return scrubDeep({ ...event, request, user: undefined });
}

/**
 * Scrubs a streamed span (Sentry 11 sends spans this way by default; `beforeSendTransaction`
 * is not called). Spans cannot be dropped, so on failure a stripped placeholder is sent.
 */
function sanitizeSpan(span: StreamedSpanJSON): StreamedSpanJSON {
  try {
    return scrubDeep(span);
  } catch {
    return { ...span, name: REDACTED, attributes: {}, links: undefined };
  }
}

/**
 * Runs a sanitizer and fails closed: if sanitizing throws, the payload is dropped rather
 * than sent unscrubbed.
 */
function failClosed<T>(sanitize: (input: T) => T): (input: T) => T | null {
  return (input) => {
    try {
      return sanitize(input);
    } catch {
      return null;
    }
  };
}

/**
 * Builds Sentry options shared by server and client init.
 * Disabled when no DSN is configured (local dev, CI). Every outgoing error, trace and
 * breadcrumb is sanitized before it leaves the process.
 */
export function buildSentryOptions(input: {
  dsn?: string;
  environment: string;
}): SentryOptions {
  return {
    enabled: Boolean(input.dsn),
    dsn: input.dsn,
    environment: input.environment,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    beforeSend: failClosed(sanitizeEvent<ErrorEvent>),
    beforeSendTransaction: failClosed(sanitizeEvent<TransactionEvent>),
    beforeBreadcrumb: failClosed(scrubDeep<Breadcrumb>),
    beforeSendSpan: sanitizeSpan,
  };
}
