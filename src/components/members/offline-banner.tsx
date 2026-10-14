"use client";

import { WifiSlash } from "@phosphor-icons/react";
import { format, isSameDay } from "date-fns";
import { useNow, useTranslations } from "next-intl";
import { Sticker } from "@/components/ui/sticker";
import { useOnline } from "@/hooks/use-online";

/**
 * Offline on `/invites` (spec §7.4), or shown this device's saved copy on a weak connection
 * (`saved`): says when the shown list was made, by the server's clock (`asOf`), in this device's
 * time and with the day when it isn't today, so an old copy never looks fresh.
 */
export function OfflineBanner({
  asOf,
  saved,
}: {
  asOf: string | null;
  saved: boolean;
}) {
  const t = useTranslations("Offline");
  const online = useOnline();
  const now = useNow();
  if ((online && !saved) || !asOf) {
    return null;
  }
  const made = new Date(asOf);
  return (
    <p
      role="status"
      className="flex items-center gap-3 rounded-control border-2 border-outline bg-fill-warning p-3 font-bold text-on-fill"
    >
      <Sticker tone="surface" size="sm">
        <WifiSlash weight="bold" />
      </Sticker>
      {t("banner", {
        time: format(made, isSameDay(made, now) ? "HH:mm" : "EEE d MMM, HH:mm"),
      })}
    </p>
  );
}
