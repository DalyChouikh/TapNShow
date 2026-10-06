"use client";

import { DropdownMenu as MenuPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Radix dropdown menu root (roving focus, typeahead, Escape). */
export function DropdownMenu(props: ComponentProps<typeof MenuPrimitive.Root>) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

/** Element that opens the menu. */
export function DropdownMenuTrigger(
  props: ComponentProps<typeof MenuPrimitive.Trigger>,
) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

/** Outlined menu panel with the hard shadow; pops in unless reduced motion. */
export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-56 origin-(--radix-dropdown-menu-content-transform-origin) rounded-card border-[length:var(--tn-border-width)] border-outline bg-surface p-1.5 text-ink shadow-brutal data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 motion-reduce:animate-none",
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

/** Menu option: 44px tap target, primary fill while highlighted. */
export function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-2 rounded-control px-3 text-sm font-bold outline-hidden select-none data-highlighted:bg-fill-primary data-highlighted:text-on-fill [&_svg]:size-5 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

/** Non-interactive heading inside the menu. */
export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cn("px-3 py-2 text-xs font-bold text-muted-ink", className)}
      {...props}
    />
  );
}

/** Divider between groups. */
export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      className={cn("my-1 h-0.5 bg-outline/20", className)}
      {...props}
    />
  );
}
