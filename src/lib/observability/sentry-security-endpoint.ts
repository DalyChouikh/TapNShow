/**
 * Sentry's CSP report address for a DSN (`https://<key>@<host>/<project>` →
 * `https://<host>/api/<project>/security/?sentry_key=<key>&sentry_environment=<env>`).
 * Undefined without a usable DSN (local development, CI, e2e), so no report directive is sent.
 */
export function sentrySecurityEndpoint(
  dsn: string | undefined,
  environment: string,
): string | undefined {
  if (!dsn || !URL.canParse(dsn)) {
    return undefined;
  }
  const url = new URL(dsn);
  const project = url.pathname.replace(/^\//, "");
  if (!url.username || !project) {
    return undefined;
  }
  const query = new URLSearchParams({
    sentry_key: url.username,
    sentry_environment: environment,
  });
  return `${url.protocol}//${url.host}/api/${project}/security/?${query.toString()}`;
}
