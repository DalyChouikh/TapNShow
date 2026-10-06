"use client";

import { Toaster as Sonner } from "sonner";

/** Toast host: outlined Neobrutalist cards at the top (the bottom bar owns the bottom edge). */
export function Toaster() {
  return (
    <Sonner
      position="top-center"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-3 rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface px-4 py-3 text-sm font-bold text-ink shadow-brutal",
          error: "bg-fill-danger text-on-fill",
        },
      }}
    />
  );
}
