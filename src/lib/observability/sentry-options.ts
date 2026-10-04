import type { Breadcrumb, ErrorEvent, TransactionEvent } from "@sentry/core";
import { scrubHeaders, scrubRecord, scrubUrl } from "./scrub";

/** Sample rate for performance traces (free tier friendly). */
export const TRACES_SAMPLE_RATE = 0.1;

/** The subset of Sentry init options TapNShow controls. */
export type SentryOptions = {
  enabled: boolean;
  dsn?: string;
  environment: string;
  tracesSampleRate: number;
  sendDefaultPii: false;
  beforeSend: (event: ErrorEvent) => ErrorEvent;
  beforeSendTransaction: (event: TransactionEvent) => TransactionEvent;
  beforeBreadcrumb: (breadcrumb: Breadcrumb) => Breadcrumb;
};

/** Scrubs personal-link tokens from a breadcrumb's message and data values. */
function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return {
    ...breadcrumb,
    message: breadcrumb.message ? scrubUrl(breadcrumb.message) : undefined,
    data: breadcrumb.data ? scrubRecord(breadcrumb.data) : undefined,
  };
}

/** Scrubs the parts shared by error and transaction events. */
function scrubCommon<T extends ErrorEvent | TransactionEvent>(event: T): T {
  if (event.request) {
    event.request = {
      ...event.request,
      url: event.request.url ? scrubUrl(event.request.url) : undefined,
      headers: event.request.headers
        ? scrubHeaders(event.request.headers)
        : undefined,
    };
  }
  if (event.contexts) {
    event.contexts = Object.fromEntries(
      Object.entries(event.contexts).map(([name, context]) => [
        name,
        context ? scrubRecord(context) : context,
      ]),
    );
  }
  if (event.transaction) {
    event.transaction = scrubUrl(event.transaction);
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  }
  return event;
}

/**
 * Builds Sentry options shared by server and client init.
 * Disabled when no DSN is configured (local dev, CI). Every outgoing error, trace and
 * breadcrumb is scrubbed of personal-link tokens and credential headers.
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
    beforeSend: (event) => scrubCommon(event),
    beforeSendTransaction: (event) => {
      const scrubbed = scrubCommon(event);
      if (scrubbed.spans) {
        scrubbed.spans = scrubbed.spans.map((span) => ({
          ...span,
          description: span.description
            ? scrubUrl(span.description)
            : undefined,
          data: scrubRecord(span.data),
        }));
      }
      return scrubbed;
    },
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
