import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { InvitePreview } from "./invite-preview";

/** The first screen (layout A): the promise on the left, the invite on the right from md up. */
export function LandingHero() {
  const t = useTranslations("Landing");
  return (
    <section
      aria-labelledby="landing-title"
      className="mx-auto grid max-w-5xl items-center gap-8 px-4 py-10 md:grid-cols-2 md:py-16"
    >
      <div className="flex flex-col gap-4">
        <p className="w-fit rounded-full border-2 border-outline bg-fill-warning px-3 py-1 text-sm font-bold text-on-fill">
          {t("eyebrow")}
        </p>
        <h1
          id="landing-title"
          className="font-display text-4xl leading-tight md:text-5xl"
        >
          {t("title")}
        </h1>
        <p className="text-lg text-muted-ink">{t("lead")}</p>
        <div className="flex flex-wrap gap-3">
          <Button asChild tone="primary">
            <Link href="/login">{t("getStarted")}</Link>
          </Button>
          <Button asChild>
            <a href="#how-it-works">{t("seeHow")}</a>
          </Button>
        </div>
      </div>
      <InvitePreview />
    </section>
  );
}
