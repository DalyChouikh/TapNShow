"use client";

import { ArrowLeft } from "@phosphor-icons/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminWorkspace } from "@/hooks/use-admin";
import { ApiClientError } from "@/lib/api-client";
import { LoadError } from "@/components/errors/load-error";
import { SuspensionActions } from "./suspension-actions";
import { SuspensionHistory } from "./suspension-history";
import { WorkspaceFacts } from "./workspace-facts";

function BackLink() {
  const t = useTranslations("Admin.workspace");
  return (
    <Link
      href="/admin/workspaces"
      className="inline-flex min-h-11 items-center gap-2 self-start font-bold"
    >
      <ArrowLeft weight="bold" aria-hidden className="size-4" />
      {t("back")}
    </Link>
  );
}

/**
 * `/admin/workspaces/[id]` (spec §7.19): suspend or lift sending, copy the Owner's address, the
 * workspace's facts, its last 30 days and its suspension history. A deleted workspace (its log
 * lines still link here) is said to be gone.
 */
export function AdminWorkspaceView({ id }: { id: string }) {
  const t = useTranslations("Admin.workspace");
  const workspace = useAdminWorkspace(id);
  const gone =
    workspace.error instanceof ApiClientError && workspace.error.status === 404;
  return (
    <div className="flex flex-col gap-4">
      <BackLink />
      {gone ? (
        <Card as="section">
          <p>{t("gone")}</p>
        </Card>
      ) : workspace.isError && !workspace.data ? (
        <LoadError onRetry={() => void workspace.refetch()} />
      ) : !workspace.data ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-11 w-48" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : (
        <>
          <h1 className="font-display text-3xl break-words">
            {workspace.data.name}
          </h1>
          <SuspensionActions workspace={workspace.data} />
          <WorkspaceFacts workspace={workspace.data} />
          <SuspensionHistory suspensions={workspace.data.suspensions} />
        </>
      )}
    </div>
  );
}
