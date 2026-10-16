import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({
  analytics: null as
    null | ((event: { type: "pageview"; url: string }) => object | null),
  speed: null as
    null | ((event: { type: "vital"; url: string }) => object | null),
  sampleRate: 0,
}));
const env = vi.hoisted(() => ({
  NEXT_PUBLIC_VERCEL_ENV: "production" as string | undefined,
}));
vi.mock("@/config/public-env", () => ({ publicEnv: env }));
vi.mock("@vercel/analytics/next", () => ({
  Analytics: (props: { beforeSend: typeof seen.analytics }) => {
    seen.analytics = props.beforeSend;
    return null;
  },
}));
vi.mock("@vercel/speed-insights/next", () => ({
  SpeedInsights: (props: {
    beforeSend: typeof seen.speed;
    sampleRate: number;
  }) => {
    seen.speed = props.beforeSend;
    seen.sampleRate = props.sampleRate;
    return null;
  },
}));

import { PageAnalytics } from "./page-analytics";

describe("PageAnalytics", () => {
  it("sends route patterns, never tokens, and samples half of the vitals", () => {
    render(<PageAnalytics />);
    expect(
      seen.analytics?.({
        type: "pageview",
        url: "https://x.app/r/secret123?choice=late",
      }),
    ).toEqual({
      type: "pageview",
      url: "https://x.app/r/[token]",
    });
    expect(
      seen.speed?.({ type: "vital", url: "https://x.app/u/secret" }),
    ).toEqual({
      type: "vital",
      url: "https://x.app/u/[token]",
    });
    expect(seen.sampleRate).toBe(0.5);
  });

  it("renders nothing outside a Vercel deployment (the scripts only exist there)", () => {
    env.NEXT_PUBLIC_VERCEL_ENV = undefined;
    seen.analytics = null;
    seen.speed = null;
    render(<PageAnalytics />);
    expect(seen.analytics).toBeNull();
    expect(seen.speed).toBeNull();
    env.NEXT_PUBLIC_VERCEL_ENV = "production";
  });
});
