"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { CONFETTI_PIECES, springs } from "@/design/motion";
import { useIsClient } from "@/lib/use-is-client";
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
 * The entrance plays only when the stamp appears after a user action on the client.
 * Server-rendered (or hydrating) stamps and reduced-motion users get the final state
 * immediately: fully visible, no shake, no confetti. Announced via `role="status"`.
 */
export function ConfirmStamp({
  label,
  show,
}: {
  label: string;
  show: boolean;
}) {
  const isClient = useIsClient();
  // Decided once at mount: false for SSR/hydration, true for a client-side mount.
  const [entranceAllowed] = useState(isClient);
  const reduced = usePrefersReducedMotion();
  const animate = entranceAllowed && !reduced;

  if (!show) return null;

  return (
    <motion.div
      role="status"
      className="relative flex items-center justify-center py-6"
      animate={animate ? { x: [0, -4, 4, 0] } : undefined}
      transition={{ delay: 0.35, duration: 0.35 }}
    >
      <motion.span
        className="rounded-control border-4 border-outline bg-surface px-4 py-1.5 font-display text-2xl text-ink shadow-brutal-lg"
        initial={animate ? { scale: 2.4, rotate: -8, opacity: 0 } : false}
        animate={{ scale: 1, rotate: -8, opacity: 1 }}
        transition={springs.stamp}
      >
        {label}
      </motion.span>
      {animate
        ? CONFETTI_PIECES.map((piece, index) => (
            <motion.span
              key={index}
              data-testid="confetti-piece"
              aria-hidden
              className={cn(
                "absolute h-3.5 w-2.5 rounded-sm border-2 border-outline motion-reduce:hidden",
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
          ))
        : null}
    </motion.div>
  );
}
