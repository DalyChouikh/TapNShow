"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmNameDialog } from "@/components/forms/confirm-name-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ME_QUERY_KEY } from "@/hooks/use-me";
import { membersQueryKey } from "@/hooks/use-members";
import { workspaceQueryKey } from "@/hooks/use-workspace";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import type { Member } from "@/shared/api/members";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

type Open = "leave" | "transfer" | "delete" | null;

/** Settings > Danger zone (spec §7.11): Owner transfers or deletes; everyone else can leave. */
export function DangerZone({
  workspace,
  myId,
  members,
}: {
  workspace: WorkspaceDetails;
  myId: string;
  members: Member[];
}) {
  const t = useTranslations("Settings.danger");
  const tCommon = useTranslations("Common");
  const tErrors = useTranslations("ApiErrors");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<Open>(null);
  const [newOwner, setNewOwner] = useState("");
  const base = `/api/workspaces/${workspace.slug}`;
  const admins = members.filter((member) => member.role === "admin");
  const errorText = (error: Error | null) =>
    error
      ? tErrors(error instanceof ApiClientError ? error.code : "internal")
      : undefined;
  const leaveWorkspace = async () => {
    await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    router.replace("/welcome");
  };

  const leave = useMutation({
    mutationFn: () =>
      apiRequest(`${base}/members/${myId}`, {
        method: "DELETE",
        schema: okSchema,
      }),
    onSuccess: leaveWorkspace,
  });
  const remove = useMutation({
    mutationFn: (confirmName: string) =>
      apiRequest(base, {
        method: "DELETE",
        body: { confirmName },
        schema: okSchema,
      }),
    onSuccess: leaveWorkspace,
  });
  const transfer = useMutation({
    mutationFn: (confirmName: string) =>
      apiRequest(`${base}/transfer`, {
        method: "POST",
        body: { userId: newOwner, confirmName },
        schema: okSchema,
      }),
    onSuccess: async () => {
      setOpen(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKey(workspace.slug),
        }),
        queryClient.invalidateQueries({
          queryKey: membersQueryKey(workspace.slug),
        }),
        queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
      ]);
    },
  });

  return (
    <Card
      as="section"
      aria-labelledby="danger-title"
      className="flex flex-col gap-3"
    >
      <h2 id="danger-title" className="font-display text-xl">
        {t("title")}
      </h2>
      {workspace.myRole === "owner" ? (
        <>
          <Button tone="warning" onClick={() => setOpen("transfer")}>
            {t("transfer")}
          </Button>
          <Button tone="danger" onClick={() => setOpen("delete")}>
            {t("delete")}
          </Button>
        </>
      ) : (
        <Button tone="danger" onClick={() => setOpen("leave")}>
          {t("leave")}
        </Button>
      )}

      <Dialog
        open={open === "leave"}
        onOpenChange={(next) => setOpen(next ? "leave" : null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("leaveConfirm", { workspace: workspace.name })}
            </DialogTitle>
          </DialogHeader>
          {leave.error ? (
            <p role="alert" className="text-sm font-bold">
              {errorText(leave.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setOpen(null)}>{tCommon("cancel")}</Button>
            <Button
              tone="danger"
              disabled={leave.isPending}
              onClick={() => leave.mutate()}
            >
              {t("leave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmNameDialog
        open={open === "transfer"}
        onOpenChange={(next) => setOpen(next ? "transfer" : null)}
        title={t("transfer")}
        body={t("transferBody")}
        name={workspace.name}
        confirmLabel={t("confirm")}
        pending={transfer.isPending}
        error={errorText(transfer.error)}
        canConfirm={newOwner !== ""}
        onConfirm={(typed) => transfer.mutate(typed)}
      >
        {admins.length === 0 ? (
          <p className="font-bold">{t("noAdmins")}</p>
        ) : (
          <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
            {t("transferTo")}
            <select
              value={newOwner}
              onChange={(event) => setNewOwner(event.target.value)}
              className="min-h-11 rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface px-3 text-base font-normal"
            >
              <option value="" disabled>
                {t("choose")}
              </option>
              {admins.map((admin) => (
                <option key={admin.userId} value={admin.userId}>
                  {admin.displayName ?? admin.email}
                </option>
              ))}
            </select>
          </label>
        )}
      </ConfirmNameDialog>

      <ConfirmNameDialog
        open={open === "delete"}
        onOpenChange={(next) => setOpen(next ? "delete" : null)}
        title={t("delete")}
        body={t("deleteBody", { workspace: workspace.name })}
        name={workspace.name}
        confirmLabel={t("confirm")}
        pending={remove.isPending}
        error={errorText(remove.error)}
        onConfirm={(typed) => remove.mutate(typed)}
      />
    </Card>
  );
}
