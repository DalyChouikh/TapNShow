import type { Transition } from "motion/react";
import type { FillTone } from "./tokens";

/** Spring presets for the Expressive motion style. */
export const springs = {
  press: { type: "spring", stiffness: 600, damping: 30 },
  pop: { type: "spring", stiffness: 500, damping: 18 },
  enter: { type: "spring", stiffness: 260, damping: 20 },
  stamp: { type: "spring", stiffness: 420, damping: 14 },
} as const satisfies Record<string, Transition>;

/** Delay between siblings in staggered entrances, in seconds. */
export const STAGGER_SECONDS = 0.07;

/** Confetti burst layout: offsets (px), rotation (deg), and fill tone per piece. */
export const CONFETTI_PIECES: ReadonlyArray<{
  x: number;
  y: number;
  rotate: number;
  tone: FillTone;
}> = [
  { x: -110, y: -120, rotate: -200, tone: "warning" },
  { x: 100, y: -130, rotate: 220, tone: "danger" },
  { x: -120, y: 90, rotate: 160, tone: "primary" },
  { x: 115, y: 100, rotate: -180, tone: "info" },
  { x: 10, y: -160, rotate: 300, tone: "success" },
  { x: -20, y: 150, rotate: -260, tone: "neutral" },
];
