"use client";

import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The rendered invite in a sandboxed iframe (`sandbox=""`: no scripts, no navigation out, no
 * same-origin access), so the email's own styles cannot leak into the app.
 */
export function EmailPreviewDialog({
  open,
  onOpenChange,
  html,
  subject,
  recipientName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  html: string;
  subject: string;
  recipientName: string;
}) {
  const t = useTranslations("Wizard.review");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("previewTitle")}</DialogTitle>
          <p className="text-sm text-muted-ink">
            {t("previewTo", { name: recipientName })}
          </p>
          <p className="text-sm break-words text-muted-ink">
            {t("previewSubject", { subject })}
          </p>
        </DialogHeader>
        <iframe
          title={t("previewTitle")}
          sandbox=""
          srcDoc={html}
          className="h-[60dvh] w-full rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface"
        />
      </DialogContent>
    </Dialog>
  );
}
