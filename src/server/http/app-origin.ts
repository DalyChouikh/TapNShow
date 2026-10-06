import "server-only";
import { getServerEnv } from "@/config/env";
import { publicEnv } from "@/config/public-env";

/** Origins this deployment may put in links it sends (no request header can add to them). */
type TrustedOrigins = {
  /** `NEXT_PUBLIC_APP_URL`: the canonical app URL. */
  appUrl: string;
  /** Vercel system variable `VERCEL_URL` (host of this deployment). */
  vercelUrl?: string;
  /** Vercel system variable `VERCEL_BRANCH_URL` (host of this branch's preview alias). */
  vercelBranchUrl?: string;
};

/**
 * Origin for links the platform sends (e.g. invite emails). The request's origin is only kept when
 * it is one of this deployment's own URLs; otherwise the configured app URL is used, so a spoofed
 * Host / Origin can never make the platform email a link to another site.
 */
export function trustedAppOrigin(
  requestOrigin: string,
  trusted: TrustedOrigins,
): string {
  const allowed = [
    new URL(trusted.appUrl).origin,
    ...[trusted.vercelUrl, trusted.vercelBranchUrl]
      .filter((host): host is string => Boolean(host))
      .map((host) => `https://${host}`),
  ];
  return allowed.includes(requestOrigin) ? requestOrigin : allowed[0];
}

/** `trustedAppOrigin` for the current request and environment. */
export function appOriginFor(request: Request): string {
  const env = getServerEnv();
  return trustedAppOrigin(new URL(request.url).origin, {
    appUrl: publicEnv.NEXT_PUBLIC_APP_URL,
    vercelUrl: env.VERCEL_URL,
    vercelBranchUrl: env.VERCEL_BRANCH_URL,
  });
}
