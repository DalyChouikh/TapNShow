/** One `headers()` rule of next.config. */
type HeaderRule = {
  source: string;
  headers: Array<{ key: string; value: string }>;
};

/**
 * Pages whose URL carries a secret token (invite links now, personal response links in M5) send no
 * `Referer` at all, so the token never leaks to other sites or into third-party logs (spec §11).
 * The full header audit is M9.
 */
export const tokenPageHeaders: HeaderRule[] = [
  "/invite/:token*",
  "/r/:token*",
].map((source) => ({
  source,
  headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
}));
