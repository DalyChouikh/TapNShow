"use client";

import { CaretDown, Check } from "@phosphor-icons/react";
import { Select as SelectPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Radix select root (typeahead, keyboard, ARIA combobox/listbox). */
export function Select(props: ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

/** Shows the chosen option (or the placeholder). */
export function SelectValue(
  props: ComponentProps<typeof SelectPrimitive.Value>,
) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

/** Field-styled trigger, matching `Input`: outline, control radius, small hard shadow. */
export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex min-h-11 w-full items-center justify-between gap-2 rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface px-3 text-left text-base text-ink shadow-brutal-sm data-[placeholder]:text-muted-ink",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <CaretDown weight="bold" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

/** Outlined option panel with the hard shadow; pops in unless reduced motion. */
export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        sideOffset={6}
        className={cn(
          "z-50 max-h-72 min-w-(--radix-select-trigger-width) overflow-hidden rounded-card border-[length:var(--tn-border-width)] border-outline bg-surface p-1.5 text-ink shadow-brutal data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 motion-reduce:animate-none",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

/** One option: 44px tall, primary fill while highlighted, check mark when chosen. */
export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-control px-3 text-sm font-bold outline-hidden select-none data-highlighted:bg-fill-primary data-highlighted:text-on-fill",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator>
        <Check weight="bold" aria-hidden />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
