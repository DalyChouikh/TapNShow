import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { useTranslations } from "next-intl";
import { Sticker } from "@/components/ui/sticker";

/** The privacy promise (spec §7.18): what TapNShow asks Google for, and what it never sees. */
export function PrivacyStrip() {
  const t = useTranslations("Landing.privacy");
  return (
    <section
      aria-labelledby="privacy-title"
      className="border-y-[length:var(--tn-border-width)] border-outline bg-fill-info text-on-fill"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8 md:flex-row md:items-center md:gap-6">
        <Sticker tone="surface">
          <ShieldCheck weight="bold" />
        </Sticker>
        <div className="flex flex-col gap-1">
          <h2 id="privacy-title" className="font-display text-2xl">
            {t("title")}
          </h2>
          <p>{t("body")}</p>
        </div>
      </div>
    </section>
  );
}
