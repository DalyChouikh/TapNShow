"use client";

import { Flag } from "@phosphor-icons/react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { InvalidLink } from "@/components/public/invalid-link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sticker } from "@/components/ui/sticker";
import { useTokenAction, useTokenInfo } from "@/hooks/use-token-page";
import { ApiClientError } from "@/lib/api-client";

/** `/report/[token]`: "Not my group" — opening reports nothing; the button does (spec §7.16). */
export function ReportView() {
  const t = useTranslations("TokenPages");
  const { token } = useParams<{ token: string }>();
  const info = useTokenInfo(token);
  const report = useTokenAction(token, "report");
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
  if (info.data.reported) {
    return (
      <>
        <Sticker tone="success">
          <Flag weight="bold" />
        </Sticker>
        <h1 className="font-display text-2xl break-words">
          {t("reportedTitle")}
        </h1>
        <p>{t("reportedBody", values)}</p>
      </>
    );
  }
  return (
    <>
      <Sticker tone="warning">
        <Flag weight="bold" />
      </Sticker>
      <h1 className="font-display text-2xl break-words">{t("reportTitle")}</h1>
      <p>{t("reportBody", values)}</p>
      <Button
        tone="danger"
        size="lg"
        className="justify-center"
        disabled={report.isPending}
        onClick={() => report.mutate()}
      >
        {t("report")}
      </Button>
    </>
  );
}
