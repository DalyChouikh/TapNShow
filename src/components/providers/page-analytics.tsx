"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { SPEED_INSIGHTS_SAMPLE_RATE } from "@/config/analytics";
import { publicEnv } from "@/config/public-env";
import { routePatternUrl } from "@/lib/observability/scrub";

/**
 * Vercel Web Analytics (no cookies) and Speed Insights (spec §5). Every URL is reduced to its
 * route pattern first, so no personal-link token reaches Vercel. Only on Vercel deployments: the
 * scripts are served by Vercel, so elsewhere (local, CI, e2e) they would 404.
 */
export function PageAnalytics() {
  if (!publicEnv.NEXT_PUBLIC_VERCEL_ENV) {
    return null;
  }
  return (
    <>
      <Analytics
        beforeSend={(event) => ({ ...event, url: routePatternUrl(event.url) })}
      />
      <SpeedInsights
        sampleRate={SPEED_INSIGHTS_SAMPLE_RATE}
        beforeSend={(event) => ({ ...event, url: routePatternUrl(event.url) })}
      />
    </>
  );
}
