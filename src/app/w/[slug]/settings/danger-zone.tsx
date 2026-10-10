"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmNameDialog } from "@/components/forms/confirm-name-dialog";
import { ShowMore } from "@/components/ui/show-more";
import { Skeleton } from "@/components/ui/skeleton";
import { PAGE_SIZE_MAX } from "@/config/pagination";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ME_QUERY_KEY } from "@/hooks/use-me";
import { membersQueryKey, useMembersPage } from "@/hooks/use-members";
import { workspaceQueryKey } from "@/hooks/use-workspace";
import { apiRequest, errorCodeOf } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { SettingsSection } from "./settings-section";

type Open = "leave" | "transfer" | "delete" | null;

/** Settings > Danger zone (spec §7.11): Owner transfers or deletes; everyone else can leave. */
export function DangerZone({
  workspace,
  defaultOpen = true,
  myId,
}: {
  workspace: WorkspaceDetails;
  defaultOpen?: boolean;
  myId: string;
}) {
  const t = useTranslations("Settings.danger");
  const tCommon = useTranslations("Common");
  const tErrors = useTranslations("ApiErrors");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<Open>(null);
  const [newOwner, setNewOwner] = useState("");
  const base = `/api/workspaces/${workspace.slug}`;
  // Admins load only when the Owner opens the transfer dialog (#174: paged, never the whole list).
  const adminPage = useMembersPage(workspace.slug, {
    role: "admin",
    limit: PAGE_SIZE_MAX,
    enabled: open === "transfer",
  });
  const admins = adminPage.items;
  const errorText = (error: Error | null) =>
    error ? tErrors(errorCodeOf(error)) : undefined;
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
    <SettingsSection id="danger" title={t("title")} defaultOpen={defaultOpen}>
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
        {adminPage.query.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : admins.length === 0 ? (
          <p className="font-bold">{t("noAdmins")}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span id="transfer-to-label" className="text-sm font-bold text-ink">
              {t("transferTo")}
            </span>
            <Select value={newOwner} onValueChange={setNewOwner}>
              <SelectTrigger aria-labelledby="transfer-to-label">
                <SelectValue placeholder={t("choose")} />
              </SelectTrigger>
              <SelectContent>
                {admins.map((admin) => (
                  <SelectItem key={admin.userId} value={admin.userId}>
                    {admin.displayName ?? admin.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ShowMore
              hasMore={adminPage.hasMore}
              loading={adminPage.isLoadingMore}
              onMore={adminPage.loadMore}
            />
          </div>
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
    </SettingsSection>
  );
}
