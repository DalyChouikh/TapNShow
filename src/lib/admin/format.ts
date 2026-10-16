/** Basis points (1/100 of a percent, as the SQL returns rates) as a percent; null stays null. */
export function percentFromBasisPoints(bp: number | null): number | null {
  return bp === null ? null : Math.round(bp) / 100;
}

/** Reports as a share of the people emailed, one decimal (100 when nobody was emailed). */
export function reportPercent(reports: number, people: number): number {
  return people > 0 ? Math.round((reports / people) * 1000) / 10 : 100;
}

/** What reached people as a share of what was tried, one decimal; null when nothing was tried. */
export function deliveredPercent(
  delivered: number,
  tried: number,
): number | null {
  if (tried <= 0) {
    return null;
  }
  return Math.round((Math.max(delivered, 0) / tried) * 1000) / 10;
}

/** This period against the previous one of the same length; `change` is null when it is new. */
export function trend(
  current: number,
  previous: number,
): { change: number | null; tone: "up" | "down" | "flat" } {
  if (previous === 0) {
    return current > 0
      ? { change: null, tone: "up" }
      : { change: 0, tone: "flat" };
  }
  const change = Math.round(((current - previous) / previous) * 100);
  return { change, tone: change > 0 ? "up" : change < 0 ? "down" : "flat" };
}

/** Clean steps per power of ten for chart axes. */
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/**
 * Three axis ticks (0, a middle step, the top) in clean whole numbers, the top at least `max` (at
 * least 2 when nothing happened, so an empty chart still has a scale).
 */
export function axisTicks(max: number): [number, number, number] {
  const half = Math.max(max, 1) / 2;
  const magnitude = 10 ** Math.floor(Math.log10(half));
  const step =
    NICE_STEPS.map((nice) => Math.round(nice * magnitude * 1e6) / 1e6).find(
      (candidate) => candidate >= half && Number.isInteger(candidate),
    ) ?? 10 * magnitude;
  return [0, step, step * 2];
}
