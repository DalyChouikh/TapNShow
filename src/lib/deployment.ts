/**
 * Whether this is the production deployment (`VERCEL_ENV`, set by Vercel; unset locally, in CI
 * and in e2e). Internal pages such as `/design` exist everywhere else.
 */
export function isProductionDeployment(vercelEnv: string | undefined): boolean {
  return vercelEnv === "production";
}
