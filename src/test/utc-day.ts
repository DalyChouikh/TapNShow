/** The UTC calendar date `offset` days from today, as `yyyy-MM-dd` (the admin figures' days). */
export function utcDay(offset = 0): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}
