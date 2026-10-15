import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Sticker } from "@/components/ui/sticker";

/**
 * The not-found page (spec §7.18): any unknown address and every `notFound()`. Someone signed in
 * gets the app first (`/welcome` sends each person to their place). The card's content only: the
 * page around it is the caller's (`not-found.tsx`; the design showcase).
 */
export function NotFoundView({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations("Errors");
  return (
    <>
      <Sticker tone="info">
        <MagnifyingGlass weight="bold" />
      </Sticker>
      <h1 className="font-display text-3xl">{t("notFoundTitle")}</h1>
      <p>{t("notFoundBody")}</p>
      <div className="flex flex-col gap-3">
        {signedIn ? (
          <Button asChild tone="primary">
            <Link href="/welcome">{t("openApp")}</Link>
          </Button>
        ) : null}
        <Button asChild tone={signedIn ? "surface" : "primary"}>
          <Link href="/">{t("goHome")}</Link>
        </Button>
      </div>
    </>
  );
}
