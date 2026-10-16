import type { Icon } from "@phosphor-icons/react";
import {
  BellRinging,
  ChartBar,
  EnvelopeSimple,
  HandTap,
  Table,
  UserCheck,
} from "@phosphor-icons/react/dist/ssr";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Sticker, type StickerTone } from "@/components/ui/sticker";

const FEATURES: ReadonlyArray<{
  key: "gmail" | "oneTap" | "live" | "checkIn" | "reminders" | "sheet";
  glyph: Icon;
  tone: StickerTone;
}> = [
  { key: "gmail", glyph: EnvelopeSimple, tone: "primary" },
  { key: "oneTap", glyph: HandTap, tone: "success" },
  { key: "live", glyph: ChartBar, tone: "warning" },
  { key: "checkIn", glyph: UserCheck, tone: "info" },
  { key: "reminders", glyph: BellRinging, tone: "danger" },
  { key: "sheet", glyph: Table, tone: "neutral" },
];

/** The six features (spec §7.18), each in a sticker. */
export function Features() {
  const t = useTranslations("Landing.features");
  return (
    <section
      aria-labelledby="features-title"
      className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10"
    >
      <h2 id="features-title" className="font-display text-3xl">
        {t("title")}
      </h2>
      <ul className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 md:grid-cols-3">
        {FEATURES.map(({ key, glyph: Glyph, tone }) => (
          <li key={key}>
            <Card className="flex h-full flex-col gap-2">
              <Sticker tone={tone}>
                <Glyph weight="bold" />
              </Sticker>
              <h3 className="font-bold">{t(`${key}.title`)}</h3>
              <p className="text-sm text-muted-ink">{t(`${key}.body`)}</p>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
