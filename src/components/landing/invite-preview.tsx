import type { Icon } from "@phosphor-icons/react";
import { CheckCircle, Clock, XCircle } from "@phosphor-icons/react/dist/ssr";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const CHOICES: ReadonlyArray<{
  key: "attending" | "late" | "absent";
  glyph: Icon;
  fill: string;
}> = [
  {
    key: "attending",
    glyph: CheckCircle,
    fill: "bg-fill-success text-on-fill",
  },
  { key: "late", glyph: Clock, fill: "" },
  { key: "absent", glyph: XCircle, fill: "" },
];

/** A still picture of the invite members get (spec §7.18): the answer page's own labels. */
export function InvitePreview() {
  const t = useTranslations("Landing.preview");
  const tChoice = useTranslations("AnswerPage.choice");
  return (
    <figure aria-label={t("label")} className="m-0">
      <Card className="flex -rotate-1 flex-col gap-2">
        <p className="text-sm text-muted-ink">{t("from")}</p>
        <p className="font-display text-2xl">{t("title")}</p>
        <p className="text-sm text-muted-ink">{t("when")}</p>
        <ul className="mt-2 flex flex-col gap-2">
          {CHOICES.map(({ key, glyph: Glyph, fill }) => (
            <li
              key={key}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-control border-[length:var(--tn-border-width)] border-outline px-3 font-bold",
                fill,
              )}
            >
              <Glyph weight="bold" aria-hidden className="size-5" />
              {tChoice(key)}
            </li>
          ))}
        </ul>
      </Card>
    </figure>
  );
}
