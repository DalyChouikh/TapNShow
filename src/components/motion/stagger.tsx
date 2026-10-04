"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { STAGGER_SECONDS, springs } from "@/design/motion";

/** Container whose `StaggerItem` children rise in one after another. */
export function Stagger({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
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
