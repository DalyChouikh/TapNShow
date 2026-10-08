"use client";

import { CaretDown } from "@phosphor-icons/react";
import { Collapsible } from "radix-ui";
import { type ReactNode, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const pointsAt = (id: string) =>
  typeof window !== "undefined" && window.location.hash === `#${id}`;

/**
 * One Settings card whose body folds away under its heading (accordion pattern: the `h2` wraps the
 * toggle button). A link to `#<id>` opens it, also when the hash changes on this page.
 */
export function SettingsSection({
  id,
  title,
  icon,
  defaultOpen = true,
  forceOpen = false,
  className,
  children,
}: {
  id: string;
  title: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  /** Opens it regardless (e.g. a connect result waiting inside). */
  forceOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  // Read once on mount: a `#<id>` link opens (and scrolls to) this section.
  const [fromLink] = useState(() => pointsAt(id));
  const [open, setOpen] = useState(() => defaultOpen || forceOpen || fromLink);
  useEffect(() => {
    if (fromLink) {
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    }
    const onHash = () => {
      if (pointsAt(id)) {
        setOpen(true);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [fromLink, id]);
  return (
    <Card
      as="section"
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-20"
    >
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <h2 id={`${id}-title`} className="font-display text-xl">
          <Collapsible.Trigger className="group flex min-h-11 w-full items-center gap-3 text-left">
            {icon}
            <span className="flex-1">{title}</span>
            <CaretDown
              weight="bold"
              aria-hidden
              className="size-5 shrink-0 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            />
          </Collapsible.Trigger>
        </h2>
        <Collapsible.Content
          className={cn("flex flex-col gap-4 pt-3", className)}
        >
          {children}
        </Collapsible.Content>
      </Collapsible.Root>
    </Card>
  );
}
