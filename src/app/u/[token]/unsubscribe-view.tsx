"use client";

import { BellSlash } from "@phosphor-icons/react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sticker } from "@/components/ui/sticker";
import { useTokenAction, useTokenInfo } from "@/hooks/use-token-page";
import { ApiClientError } from "@/lib/api-client";
import { InvalidLink } from "@/components/public/invalid-link";

/** `/u/[token]`: opening never unsubscribes (link scanners open links); the button does (spec §7.16). */
export function UnsubscribeView() {
  const t = useTranslations("TokenPages");
  const { token } = useParams<{ token: string }>();
  const info = useTokenInfo(token);
  const unsubscribe = useTokenAction(token, "unsubscribe");
  const resubscribe = useTokenAction(token, "resubscribe");
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
  const values = {
    workspace: info.data.workspaceName,
    email: info.data.maskedEmail,
  };
  if (info.data.unsubscribed) {
    return (
      <>
        <Sticker tone="neutral">
          <BellSlash weight="bold" />
        </Sticker>
        <h1 className="font-display text-2xl break-words">
          {resubscribe.isSuccess
            ? t("resubscribedTitle")
            : t("unsubscribedTitle")}
        </h1>
        <p>{t("unsubscribedBody", values)}</p>
        <Button
          disabled={resubscribe.isPending}
          onClick={() => resubscribe.mutate()}
        >
          {t("resubscribe")}
        </Button>
      </>
    );
  }
  return (
    <>
      <Sticker tone="warning">
        <BellSlash weight="bold" />
      </Sticker>
      <h1 className="font-display text-2xl break-words">
        {resubscribe.isSuccess
          ? t("resubscribedTitle")
          : t("unsubscribeTitle", values)}
      </h1>
      <p>
        {resubscribe.isSuccess
          ? t("resubscribedBody", values)
          : t("unsubscribeBody", values)}
      </p>
      <Button
        tone="danger"
        size="lg"
        className="justify-center"
        disabled={unsubscribe.isPending}
        onClick={() => unsubscribe.mutate()}
      >
        {t("unsubscribe")}
      </Button>
    </>
  );
}
