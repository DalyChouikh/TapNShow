"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The rendered invite in a sandboxed iframe, so the email's own styles cannot leak into the app.
 * `allow-same-origin` without `allow-scripts`: nothing in it can run or navigate; the app only reads
 * its height. The frame grows to the whole email and ignores touches (its links go nowhere), so a
 * finger anywhere scrolls the dialog: touches inside a frame never reach the dialog on phones.
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
  const [height, setHeight] = useState<number | null>(null);
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
          sandbox="allow-same-origin"
          srcDoc={html}
          onLoad={(event) => {
            const page = event.currentTarget.contentDocument?.documentElement;
            if (page) {
              setHeight(page.scrollHeight);
            }
          }}
          style={height ? { height } : undefined}
          className="pointer-events-none min-h-[60dvh] w-full shrink-0 rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface"
        />
      </DialogContent>
    </Dialog>
  );
}
