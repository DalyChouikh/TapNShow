"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmNameDialog } from "@/components/forms/confirm-name-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccount } from "@/hooks/use-account";
import { apiRequest, errorCodeOf } from "@/lib/api-client";
import { clearDeviceData } from "@/lib/device/clear";
import { replaceWith } from "@/lib/navigation";
import { settingsPath } from "@/lib/with-query";
import { ACCOUNT_DELETE_WORD } from "@/shared/api/account";
import { okSchema } from "@/shared/api/common";

/**
 * Delete my account (spec §7.4, §11): blocked while the person owns a workspace (each is listed
 * with the way out); otherwise a type-"confirm" dialog naming what is erased. After the server
 * deletes, this device forgets everything and goes to sign-in.
 */
export function DeleteAccountCard() {
  const t = useTranslations("Account.delete");
  const tErrors = useTranslations("ApiErrors");
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: () =>
      apiRequest("/api/me", {
        method: "DELETE",
        body: { confirm: ACCOUNT_DELETE_WORD },
        schema: okSchema,
      }),
    onSuccess: async () => {
      await clearDeviceData();
      // A full page load drops every cached query. Clearing them here would make the mounted ones
      // refetch, get "signed out", and race this page to the plain sign-in screen.
      replaceWith("/login?deleted=1");
    },
  });
  if (!account.data) {
    return <Skeleton className="h-40 w-full" />;
  }
  const { owned, workspaces, answersWithText } = account.data;
  return (
    <Card as="section" className="flex flex-col gap-3">
      <h2 className="font-bold">{t("title")}</h2>
      <p>{t("body")}</p>
      {owned.length > 0 ? (
        <>
          <p className="font-bold">{t("owned")}</p>
          <ul className="flex flex-col gap-2">
            {owned.map((workspace) => {
              const href = settingsPath(workspace.slug, "danger");
              return (
                <li
                  key={workspace.slug}
                  className="flex flex-col gap-2 rounded-control border-2 border-outline p-3"
                >
                  <span className="font-bold break-words">
                    {workspace.name}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild>
                      <Link href={href}>{t("transfer")}</Link>
                    </Button>
                    <Button asChild>
                      <Link href={href}>{t("deleteWorkspace")}</Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      <Button
        tone="danger"
        className="self-start"
        disabled={owned.length > 0}
        onClick={() => setOpen(true)}
      >
        {t("button")}
      </Button>
      <ConfirmNameDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            remove.reset();
          }
        }}
        title={t("dialogTitle")}
        body={t("dialogBody", { answers: answersWithText, workspaces })}
        name={ACCOUNT_DELETE_WORD}
        inputLabel={t("typeWord", { word: ACCOUNT_DELETE_WORD })}
        confirmLabel={t("button")}
        pending={remove.isPending}
        error={remove.isError ? tErrors(errorCodeOf(remove.error)) : undefined}
        onConfirm={() => remove.mutate()}
      />
    </Card>
  );
}
