"use client";

import { Command as CommandPrimitive } from "cmdk";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Searchable list (cmdk): filtering, keyboard navigation and ARIA listbox semantics. */
export function Command({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn("flex flex-col gap-2 text-ink", className)}
      {...props}
    />
  );
}

/** Search field of a `Command`. */
export function CommandInput({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <CommandPrimitive.Input
      data-slot="command-input"
      className={cn(
        "min-h-11 rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface px-3 text-base text-ink placeholder:text-muted-ink",
        className,
      )}
      {...props}
    />
  );
}

/** Scrollable options area. */
export function CommandList({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn("max-h-64 overflow-y-auto overscroll-contain", className)}
      {...props}
    />
  );
}

/** Shown when no option matches the search. */
export function CommandEmpty({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("px-3 py-2 text-sm text-muted-ink", className)}
      {...props}
    />
  );
}

/** One option; highlighted with the primary fill while selected via keyboard or pointer. */
export function CommandItem({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "flex min-h-11 cursor-pointer items-center rounded-control px-3 text-sm font-bold data-[selected=true]:bg-fill-primary data-[selected=true]:text-on-fill",
        className,
      )}
      {...props}
    />
  );
}
