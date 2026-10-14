import { WifiSlash } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PublicPage } from "@/components/public/public-page";
import { Button } from "@/components/ui/button";
import { Sticker } from "@/components/ui/sticker";

/** What the service worker shows for a page it has no copy of while offline (spec §10 PWA). */
export default async function OfflinePage() {
  const t = await getTranslations("Offline");
  return (
    <PublicPage>
      <Sticker tone="warning">
        <WifiSlash weight="bold" />
      </Sticker>
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p>{t("body")}</p>
      <Button asChild tone="primary">
        <Link href="/invites">{t("openInvites")}</Link>
      </Button>
    </PublicPage>
  );
}
