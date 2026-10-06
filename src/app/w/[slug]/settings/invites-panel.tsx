"use client";

import { DotsThreeVertical, UserPlus } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { RoleBadge } from "@/components/shell/role-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { invitesQueryKey, useInvites } from "@/hooks/use-invites";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { okSchema } from "@/shared/api/common";
import { inviteDeliveredSchema, type Invite } from "@/shared/api/invites";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { InviteDialog } from "./invite-dialog";

/** Settings > People > Invites (Owner/Admin only). */
export function InvitesPanel({ workspace }: { workspace: WorkspaceDetails }) {
  const t = useTranslations("Invites");
  const tErrors = useTranslations("ApiErrors");
  const queryClient = useQueryClient();
  const canManage = workspace.myRole !== "viewer";
  const invites = useInvites(workspace.slug, canManage);
  const [dialogOpen, setDialogOpen] = useState(false);
  const base = `/api/workspaces/${workspace.slug}/invites`;
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: invitesQueryKey(workspace.slug),
    });
  const onError = (error: Error) =>
    toast.error(
      tErrors(error instanceof ApiClientError ? error.code : "internal"),
    );

  const renew = useMutation({
    mutationFn: (input: { invite: Invite; delivery: "email" | "link" }) =>
      apiRequest(`${base}/${input.invite.id}/renew`, {
        method: "POST",
        body: { delivery: input.delivery },
        schema: inviteDeliveredSchema,
      }),
    onSuccess: async (result, { invite }) => {
      await refresh();
      if (result.delivery === "link") {
        await navigator.clipboard.writeText(result.link);
        toast(t("copied", { email: invite.email }));
      } else {
        toast(t("sent", { email: invite.email }));
      }
    },
    onError,
  });
  const revoke = useMutation({
    mutationFn: (invite: Invite) =>
      apiRequest(`${base}/${invite.id}`, {
        method: "DELETE",
        schema: okSchema,
      }),
    onSuccess: async () => {
      await refresh();
      toast(t("revoked"));
    },
    onError,
  });

  if (!canManage) {
    return null;
  }
  return (
    <section
      aria-labelledby="invites-title"
      className="flex flex-col gap-3 border-t-[length:var(--tn-border-width)] border-outline pt-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id="invites-title" className="font-display text-lg">
          {t("title")}
        </h3>
        <Button tone="primary" onClick={() => setDialogOpen(true)}>
          <UserPlus weight="bold" aria-hidden />
          {t("invite")}
        </Button>
      </div>
      {!invites.data ? (
        <Skeleton className="h-16 w-full" />
      ) : invites.data.length === 0 ? (
        <p className="text-sm text-muted-ink">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {invites.data.map((invite) => (
            <li key={invite.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{invite.email}</p>
                <p className="text-sm text-muted-ink">
                  {t("expires", {
                    date: format(parseISO(invite.expiresAt), "PP"),
                  })}
                </p>
              </div>
              <RoleBadge role={invite.role} />
              <span
                className={cn(
                  "rounded-full border-2 border-outline px-2 text-xs font-bold text-on-fill",
                  invite.status === "pending"
                    ? "bg-fill-success"
                    : "bg-fill-neutral",
                )}
              >
                {t(invite.status)}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={t("actionsFor", { email: invite.email })}
                  className="inline-flex size-11 items-center justify-center rounded-control"
                >
                  <DotsThreeVertical weight="bold" aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => renew.mutate({ invite, delivery: "link" })}
                  >
                    {t("copyLink")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => renew.mutate({ invite, delivery: "email" })}
                  >
                    {t("resend")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => revoke.mutate(invite)}>
                    {t("revoke")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
      <InviteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        workspace={workspace}
      />
    </section>
  );
}
