"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import messages from "../../messages/en.json";

/** Last-resort error boundary; reports to Sentry and shows a minimal page. */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center p-4">
        <p>{messages.Errors.global}</p>
      </body>
    </html>
  );
}
