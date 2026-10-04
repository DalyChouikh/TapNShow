import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Pressable Neobrutalist button: thick outline, hard shadow that collapses on press,
 * springy hover tilt. All motion is disabled for reduced-motion users.
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-between gap-3 rounded-control border-[length:var(--tn-border-width)] border-outline px-4 font-bold text-on-fill shadow-brutal transition-[transform,box-shadow] duration-300 ease-spring select-none hover:-translate-y-0.5 hover:-rotate-[1.5deg] hover:shadow-brutal-lg active:translate-y-1 active:rotate-0 active:shadow-none active:duration-75 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:hover:rotate-0",
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
        md: "min-h-11 text-sm",
        lg: "min-h-12 w-full text-base",
      },
    },
    defaultVariants: { tone: "surface", size: "md" },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Render the single child element (e.g. a link) with button styling. */
    asChild?: boolean;
  };

/** The app's primary interactive control. Defaults to `type="button"`. */
export function Button({
  tone = "surface",
  size = "md",
  asChild = false,
  className,
  type,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      data-tone={tone}
      data-size={size}
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ tone, size }), className)}
      {...props}
    />
  );
}
