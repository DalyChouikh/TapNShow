"use client";

import type { Icon } from "@phosphor-icons/react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * One navigation destination: icon over a short label, 44 px tall, filled when current (the
 * workspace bottom bar, the admin tabs). `className` adapts the layout (the admin side menu);
 * `shortLabel` is shown below md where `label` doesn't fit, and `label` stays the link's name.
 */
export function NavLink({
  href,
  label,
  shortLabel,
  glyph: Glyph,
  active,
  className,
}: {
  href: string;
  label: string;
  shortLabel?: string;
  glyph: Icon;
  active: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={shortLabel ? label : undefined}
      className={cn(
        "flex min-h-11 min-w-14 flex-col items-center gap-0.5 rounded-control px-2 py-1 text-xs font-bold",
        active ? "bg-fill-primary text-on-fill" : "text-ink",
        className,
      )}
    >
      <Glyph weight="bold" aria-hidden className="size-6" />
      {shortLabel ? (
        <>
          <span className="md:hidden">{shortLabel}</span>
          <span className="hidden md:inline">{label}</span>
        </>
      ) : (
        label
      )}
    </Link>
  );
}
