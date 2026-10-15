"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { BrandMark } from "@/components/brand/brand-mark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/config/app";

/** Top bar of the public pages: brand, the round theme switch, Sign in or Open TapNShow. */
export function PublicHeader({
  signedIn,
  showSignIn,
}: {
  signedIn: boolean;
  showSignIn: boolean;
}) {
  const t = useTranslations("Public");
  return (
    <header className="sticky top-0 z-30 border-b-[length:var(--tn-border-width)] border-outline bg-surface">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2">
        <Link
          href="/"
          aria-label={t("home")}
          className="flex min-h-11 items-center gap-2 font-display text-lg"
        >
          <BrandMark />
          {/* Below 360 px the brand word yields to the buttons; the link keeps its label. */}
          <span className="max-[22.5rem]:sr-only">{APP_NAME}</span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {showSignIn ? (
            <Button
              asChild
              tone={signedIn ? "primary" : "surface"}
              className="whitespace-nowrap"
            >
              <Link href={signedIn ? "/welcome" : "/login"}>
                {signedIn ? t("openApp") : t("signIn")}
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
