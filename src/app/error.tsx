"use client";

import { lazy, Suspense, useEffect } from "react";
import { captureClientError } from "@/lib/observability/browser-sentry";

/**
 * Fetched when a page crashes, not with every page: as a static import its scripts (the card,
 * buttons, the translator) shipped twice on each public page's first load. If it can't be fetched
 * (offline), the failure reaches `global-error`, which needs nothing.
 */
const CrashedPage = lazy(() =>
  import("@/components/errors/error-view").then((view) => ({
    default: view.CrashedPage,
  })),
);

/** A page crashed inside the root layout (spec §7.18): theme and fonts stay; Sentry gets it. */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    captureClientError(error);
  }, [error]);
  return (
    <Suspense fallback={null}>
      <CrashedPage onRetry={() => retry()} />
    </Suspense>
  );
}
