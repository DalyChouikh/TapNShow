import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/** The last call to sign up (spec §7.18). */
export function FinalCall() {
  const t = useTranslations("Landing");
  return (
    <section
      aria-labelledby="final-title"
      className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-4 py-12 text-center"
    >
      <h2 id="final-title" className="font-display text-3xl">
        {t("final.title")}
      </h2>
      <Button asChild tone="primary">
        <Link href="/login">{t("getStarted")}</Link>
      </Button>
    </section>
  );
}
