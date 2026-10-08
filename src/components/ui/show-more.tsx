"use client";

import { useTranslations } from "next-intl";
import { Button } from "./button";

/** The foot of a paged list: "Show more" while pages remain, then a quiet end line (#174). */
export function ShowMore({
  hasMore,
  loading,
  onMore,
  endLabel,
}: {
  hasMore: boolean;
  loading: boolean;
  onMore: () => void;
  endLabel?: string;
}) {
  const t = useTranslations("Pagination");
  if (!hasMore) {
    return endLabel ? (
      <p className="py-2 text-center text-sm text-muted-ink">{endLabel}</p>
    ) : null;
  }
  return (
    <Button
      type="button"
      className="w-full justify-center"
      disabled={loading}
      aria-busy={loading}
      onClick={onMore}
    >
      {loading ? t("loading") : t("more")}
    </Button>
  );
}
