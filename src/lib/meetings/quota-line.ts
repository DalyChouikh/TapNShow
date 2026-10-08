/** Review step quota line (spec §8): what goes out now, what waits, what is left today. */
export function quotaLine(input: {
  toSend: number;
  sentLast24h: number;
  dailyLimit: number;
}) {
  const left = Math.max(input.dailyLimit - input.sentLast24h, 0);
  const now = Math.min(input.toSend, left);
  return { now, queued: input.toSend - now, leftAfter: left - now };
}
