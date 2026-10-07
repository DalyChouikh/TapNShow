import { Button } from "@/components/ui/button";

/** Dialog footer for the import steps: one fixed button height and single-line labels on every step. */
export function WizardFooter({
  backLabel,
  onBack,
  primaryLabel,
  onPrimary,
  primaryDisabled,
}: {
  backLabel?: string;
  onBack?: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled: boolean;
}) {
  return (
    <div data-slot="wizard-footer" className="mt-auto flex gap-3 pt-3">
      {backLabel && onBack ? (
        <Button
          onClick={onBack}
          className="h-11 w-24 shrink-0 justify-center whitespace-nowrap"
        >
          {backLabel}
        </Button>
      ) : null}
      <Button
        tone="primary"
        onClick={onPrimary}
        disabled={primaryDisabled}
        className="h-11 min-w-0 flex-1 justify-center truncate whitespace-nowrap"
      >
        {primaryLabel}
      </Button>
    </div>
  );
}
