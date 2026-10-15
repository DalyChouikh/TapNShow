"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { ErrorView } from "@/components/errors/error-view";
import { PublicPage } from "@/components/public/public-page";

/** A page crashed inside the root layout (spec §7.18): theme and fonts stay; Sentry gets it. */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <PublicPage>
      <ErrorView onRetry={() => retry()} />
    </PublicPage>
  );
}
