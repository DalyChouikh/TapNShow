"use client";

import { motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { STAGGER_SECONDS, springs } from "@/design/motion";
import { useIsClient } from "@/lib/use-is-client";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

/**
 * Container whose `StaggerItem` children rise in one after another. The entrance plays only when
 * the container mounts on the client after hydration; server HTML (and the hydrating render) is
 * the final, fully visible state, so content never sits at opacity 0 waiting for JavaScript (#51).
 * Reduced-motion users get no entrance.
 */
export function Stagger({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const isClient = useIsClient();
  // Decided once at mount: false for SSR/hydration, true for a client-side mount.
  const [entranceAllowed] = useState(isClient);
  const reduced = usePrefersReducedMotion();
  const animate = entranceAllowed && !reduced;
  return (
    <motion.div
      className={className}
      initial={animate ? "hidden" : false}
      animate="visible"
      variants={{
        visible: { transition: { staggerChildren: STAGGER_SECONDS } },
      }}
    >
      {children}
    </motion.div>
  );
}

/** One staggered child. */
export function StaggerItem({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  // No `initial` of its own: a child that sets one controls its own variants and stops
  // inheriting the container's `animate`, which would leave it hidden forever.
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 24 },
        visible: { opacity: 1, y: 0, transition: springs.enter },
      }}
    >
      {children}
    </motion.div>
  );
}
