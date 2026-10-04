import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Sticker background tones: any pastel fill, or the plain surface. */
const stickerVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-sticker border-2 border-outline text-on-fill shadow-brutal-sm [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        surface: "bg-surface text-ink",
        primary: "bg-fill-primary",
        success: "bg-fill-success",
        warning: "bg-fill-warning",
        danger: "bg-fill-danger",
        info: "bg-fill-info",
        neutral: "bg-fill-neutral",
      },
      size: {
        sm: "size-7 [&_svg]:size-4",
        md: "size-8 [&_svg]:size-[18px]",
      },
    },
    defaultVariants: { tone: "surface", size: "md" },
  },
);

/** Tone accepted by `<Sticker>`. */
export type StickerTone = NonNullable<
  VariantProps<typeof stickerVariants>["tone"]
>;

/**
 * Outlined pastel tile that frames a Phosphor icon (the app's emoji replacement).
 * Decorative unless `label` is provided.
 */
export function Sticker({
  tone = "surface",
  size = "md",
  label,
  className,
  children,
}: {
  tone?: StickerTone;
  size?: "sm" | "md";
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      data-tone={tone}
      className={cn(stickerVariants({ tone, size }), className)}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
    >
      {children}
    </span>
  );
}
