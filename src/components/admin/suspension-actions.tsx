"use client";

import { Copy, PauseCircle } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sticker } from "@/components/ui/sticker";
import { useLiftSuspension, useSuspendWorkspace } from "@/hooks/use-admin";
import { reportPercent } from "@/lib/admin/format";
import { errorCodeOf } from "@/lib/api-client";
import { copyText } from "@/lib/clipboard";
import type { AdminWorkspace } from "@/shared/api/admin";
import { useAdminFormat } from "./use-admin-format";

/**
 * A workspace's sending state and what an admin can do about it (spec §7.19): why it is
 * suspended, Suspend sending or Lift suspension (each confirmed, naming the consequence), and the
 * Owner's full address copied (it is only ever shown masked).
 */
export function SuspensionActions({
  workspace,
}: {
  workspace: AdminWorkspace;
}) {
  const t = useTranslations("Admin.workspace");
  const tErrors = useTranslations("ApiErrors");
  const { percent } = useAdminFormat();
  const [confirming, setConfirming] = useState(false);
  const suspend = useSuspendWorkspace(workspace.id);
  const lift = useLiftSuspension(workspace.id);
  const write = workspace.suspended ? lift : suspend;
  const open = workspace.suspensions.find((entry) => entry.liftedAt === null);
  const { name, ownerEmail } = workspace;

  const confirm = () =>
    write.mutate(undefined, {
      onSuccess: () => {
        setConfirming(false);
        toast(
          workspace.suspended
            ? t("liftedToast", { name })
            : t("suspendedToast", { name }),
        );
      },
      onError: (error) => {
        setConfirming(false);
        toast.error(tErrors(errorCodeOf(error)));
      },
    });
  const copyOwner = async (email: string) => {
    if (await copyText(email)) {
      toast(t("copied"));
    } else {
      toast.error(t("copyFailed"));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {workspace.suspended ? (
        <Card
          role="status"
          className="flex items-start gap-3 bg-fill-danger p-3 text-on-fill"
        >
          <Sticker tone="surface">
            <PauseCircle weight="bold" />
          </Sticker>
          <span className="flex min-w-0 flex-col">
            <span className="font-bold">
              {open?.reason === "auto_reports"
                ? t("suspendedAuto")
                : t("suspendedAdmin")}
            </span>
            {workspace.reports7d > 0 ? (
              <span className="text-sm">
                {workspace.people7d > 0
                  ? t("suspendedRate", {
                      reports: workspace.reports7d,
                      people: workspace.people7d,
                      rate: percent(
                        reportPercent(workspace.reports7d, workspace.people7d),
                      ),
                    })
                  : t("suspendedReports", { reports: workspace.reports7d })}
              </span>
            ) : null}
          </span>
        </Card>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          tone={workspace.suspended ? "primary" : "danger"}
          onClick={() => setConfirming(true)}
        >
          {workspace.suspended ? t("lift") : t("suspend")}
        </Button>
        {ownerEmail ? (
          <Button onClick={() => void copyOwner(ownerEmail)}>
            <Copy weight="bold" aria-hidden className="size-4" />
            {t("copyOwner")}
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          workspace.suspended
            ? t("liftTitle", { name })
            : t("suspendTitle", { name })
        }
        description={workspace.suspended ? t("liftBody") : t("suspendBody")}
        confirmLabel={workspace.suspended ? t("lift") : t("suspend")}
        tone={workspace.suspended ? "primary" : "danger"}
        pending={write.isPending}
        onConfirm={confirm}
      />
    </div>
  );
}
