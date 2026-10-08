"use client";

import { Button } from "@/components/ui/button";

/**
 * Sticky step footer above the bottom bar: Back + Next of one fixed height with single-line labels
 * on every step (M3 smoke-test rule).
 */
export function WizardFooter({
  backLabel,
  onBack,
  nextLabel,
  onNext,
  nextDisabled = false,
  pending = false,
  nextTone = "primary",
}: {
  backLabel: string;
  onBack: () => void;
  nextLabel: string;
  onNext: () => void;
  nextDisabled?: boolean;
  pending?: boolean;
  nextTone?: "primary" | "success";
}) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 border-t-[length:var(--tn-border-width)] border-outline bg-background/95 px-4 py-3">
      <div className="mx-auto flex max-w-md gap-3">
        <Button
          size="lg"
          className="w-auto shrink-0 justify-center whitespace-nowrap"
          onClick={onBack}
        >
          {backLabel}
        </Button>
        <Button
          size="lg"
          tone={nextTone}
          className="justify-center truncate whitespace-nowrap"
          disabled={nextDisabled || pending}
          aria-busy={pending || undefined}
          onClick={onNext}
        >
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}
