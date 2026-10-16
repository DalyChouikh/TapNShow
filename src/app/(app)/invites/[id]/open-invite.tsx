"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchMyInviteLink } from "@/hooks/use-my-invites";
import { errorCodeOf } from "@/lib/api-client";
import { replaceWith } from "@/lib/navigation";

/**
 * Asks for the invite's answer page and replaces itself with it, so Back returns to `/invites`.
 * The link is personal: never cached or kept (`gcTime: 0`).
 */
export function OpenInvite({ id }: { id: string }) {
  const t = useTranslations("MyInvites");
  const tErrors = useTranslations("ApiErrors");
  const link = useQuery({
    queryKey: ["my-invite-link", id],
    queryFn: () => fetchMyInviteLink(id),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  useEffect(() => {
    if (link.data) {
      replaceWith(link.data);
    }
  }, [link.data]);

  if (link.isError) {
    const code = errorCodeOf(link.error);
    return (
      <Card className="flex flex-col gap-3" role="alert">
        <p>{code === "not_found" ? t("notAvailable") : tErrors(code)}</p>
        <Button asChild>
          <Link href="/invites">{t("backToInvites")}</Link>
        </Button>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-3" aria-busy>
      <p>{t("opening")}</p>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
