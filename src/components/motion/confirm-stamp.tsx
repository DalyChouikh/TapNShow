"use client";

import { motion } from "motion/react";
import { CONFETTI_PIECES, springs } from "@/design/motion";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

const CONFETTI_FILL = {
  primary: "bg-fill-primary",
  success: "bg-fill-success",
  warning: "bg-fill-warning",
  danger: "bg-fill-danger",
  info: "bg-fill-info",
  neutral: "bg-fill-neutral",
} as const;

/**
 * The "CONFIRMED" moment: a stamp slams in, the card shakes, confetti bursts.
 * Reduced-motion users get the stamp immediately with no movement or confetti.
 */
export function ConfirmStamp({
  label,
  show,
}: {
  label: string;
  show: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  if (!show) return null;

  return (
    <motion.div
      className="relative flex items-center justify-center py-6"
      animate={reduced ? undefined : { x: [0, -4, 4, 0] }}
      transition={{ delay: 0.35, duration: 0.35 }}
    >
      <motion.span
        className="rounded-control border-4 border-outline bg-surface px-4 py-1.5 font-display text-2xl text-ink shadow-brutal-lg"
        initial={reduced ? false : { scale: 2.4, rotate: -8, opacity: 0 }}
        animate={{ scale: 1, rotate: -8, opacity: 1 }}
        transition={springs.stamp}
      >
        {label}
      </motion.span>
      {reduced
        ? null
        : CONFETTI_PIECES.map((piece, index) => (
            <motion.span
              key={index}
              data-testid="confetti-piece"
              aria-hidden
              className={cn(
                "absolute h-3.5 w-2.5 rounded-sm border-2 border-outline",
                CONFETTI_FILL[piece.tone],
              )}
              initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
              animate={{
                x: piece.x,
                y: piece.y,
                rotate: piece.rotate,
                opacity: 0,
              }}
              transition={{
                delay: 0.3,
                duration: 0.9,
                ease: [0.2, 0.8, 0.3, 1],
              }}
            />
          ))}
    </motion.div>
  );
}
