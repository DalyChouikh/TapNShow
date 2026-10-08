"use client";

import { HourglassMedium } from "@phosphor-icons/react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { InvalidLink } from "@/components/public/invalid-link";
import { MeetingCard } from "@/components/public/meeting-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sticker } from "@/components/ui/sticker";
import { useTokenInfo } from "@/hooks/use-token-page";
import { ApiClientError } from "@/lib/api-client";

/** `/r/[token]` until M5's answer form: the meeting, and that answering opens soon (`?choice=` ignored). */
export function ResponsePlaceholder() {
  const t = useTranslations("TokenPages");
  const { token } = useParams<{ token: string }>();
  const info = useTokenInfo(token);
  if (info.isPending) {
    return <Skeleton className="h-40 w-full" />;
  }
  if (!info.data) {
    return (
      <InvalidLink
        limited={
          info.error instanceof ApiClientError &&
          info.error.code === "rate_limited"
        }
      />
    );
  }
  return (
    <>
      <Sticker tone="info">
        <HourglassMedium weight="bold" />
      </Sticker>
      <h1 className="font-display text-2xl">{t("placeholderTitle")}</h1>
      <p>{t("placeholderBody")}</p>
      <MeetingCard meeting={info.data.meeting} />
    </>
  );
}
