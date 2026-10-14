"use client";

import { WifiSlash } from "@phosphor-icons/react";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { Sticker } from "@/components/ui/sticker";
import { useOnline } from "@/hooks/use-online";

/**
 * Offline on `/invites` (spec §7.4): says when the shown list was made, by the server's clock
 * (`asOf`), in this device's time, so an old copy never looks fresh.
 */
export function OfflineBanner({ asOf }: { asOf: string | null }) {
  const t = useTranslations("Offline");
  const online = useOnline();
  if (online || !asOf) {
    return null;
  }
  return (
    <p
      role="status"
      className="flex items-center gap-3 rounded-control border-2 border-outline bg-fill-warning p-3 font-bold text-on-fill"
    >
      <Sticker tone="surface" size="sm">
        <WifiSlash weight="bold" />
      </Sticker>
      {t("banner", { time: format(new Date(asOf), "HH:mm") })}
    </p>
  );
}
