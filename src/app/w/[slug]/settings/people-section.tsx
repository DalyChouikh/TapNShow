"use client";

import { DotsThreeVertical } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { RoleBadge } from "@/components/shell/role-badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { ShowMore } from "@/components/ui/show-more";
import { membersQueryKey, useMembersPage } from "@/hooks/use-members";
import { apiRequest, errorCodeOf } from "@/lib/api-client";
import { memberActions, type MemberAction } from "@/lib/member-actions";
import { okSchema } from "@/shared/api/common";
import type { Member } from "@/shared/api/members";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { SettingsSection } from "./settings-section";

/** Settings > People: members, role badges, allowed row actions. Task 12 adds invites as `children`. */
export function PeopleSection({
  workspace,
  defaultOpen = true,
  myId,
  children,
}: {
  workspace: WorkspaceDetails;
  defaultOpen?: boolean;
  myId: string;
  children?: ReactNode;
}) {
  const t = useTranslations("Settings.people");
  const tCommon = useTranslations("Common");
  const tErrors = useTranslations("ApiErrors");
  const queryClient = useQueryClient();
  const members = useMembersPage(workspace.slug);
  const [removing, setRemoving] = useState<Member | null>(null);
  const base = `/api/workspaces/${workspace.slug}/members`;
  const onError = (error: Error) => toast.error(tErrors(errorCodeOf(error)));
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: membersQueryKey(workspace.slug),
    });

  const update = useMutation({
    mutationFn: (input: {
      member: Member;
      role: "admin" | "viewer";
      canCheckIn: boolean;
    }) =>
      apiRequest(`${base}/${input.member.userId}`, {
        method: "PATCH",
        body: { role: input.role, canCheckIn: input.canCheckIn },
        schema: okSchema,
      }),
    onSuccess: async () => {
      await refresh();
      toast(t("updated"));
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (member: Member) =>
      apiRequest(`${base}/${member.userId}`, {
        method: "DELETE",
        schema: okSchema,
      }),
    onSuccess: async () => {
      setRemoving(null);
      await refresh();
    },
    onError,
  });

  const run = (action: MemberAction, member: Member) => {
    if (action === "makeAdmin") {
      update.mutate({ member, role: "admin", canCheckIn: false });
    } else if (action === "makeViewer") {
      update.mutate({ member, role: "viewer", canCheckIn: false });
    } else if (action === "toggleCheckIn") {
      update.mutate({ member, role: "viewer", canCheckIn: !member.canCheckIn });
    } else {
      setRemoving(member);
    }
  };
  const actionLabel = (action: MemberAction, member: Member) =>
    action === "toggleCheckIn"
      ? t(member.canCheckIn ? "disallowCheckIn" : "allowCheckIn")
      : t(action);

  return (
    <SettingsSection id="people" title={t("title")} defaultOpen={defaultOpen}>
      {!members.query.isPending ? (
        <ul className="flex flex-col gap-3">
          {members.items.map((member) => {
            const name =
              member.userId === myId
                ? t("you")
                : (member.displayName ?? member.email);
            const actions = memberActions(workspace.myRole, myId, member);
            return (
              <li key={member.userId} className="flex items-center gap-3">
                <Avatar name={member.displayName} email={member.email} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{name}</p>
                  <p className="truncate text-sm text-muted-ink">
                    {member.email}
                  </p>
                  {member.canCheckIn ? (
                    <p className="text-xs font-bold">{t("checkIn")}</p>
                  ) : null}
                </div>
                <RoleBadge role={member.role} />
                {actions.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={t("actionsFor", { name })}
                      className="inline-flex size-11 items-center justify-center rounded-control"
                    >
                      <DotsThreeVertical weight="bold" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {actions.map((action) => (
                        <DropdownMenuItem
                          key={action}
                          onSelect={() => run(action, member)}
                        >
                          {actionLabel(action, member)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <Skeleton className="h-32 w-full" />
      )}
      <ShowMore
        hasMore={members.hasMore}
        loading={members.isLoadingMore}
        onMore={members.loadMore}
      />
      {children}
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => (open ? undefined : setRemoving(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {removing
                ? t("removeConfirm", {
                    name: removing.displayName ?? removing.email,
                    workspace: workspace.name,
                  })
                : null}
            </DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setRemoving(null)}>
              {tCommon("cancel")}
            </Button>
            <Button
              tone="danger"
              disabled={remove.isPending}
              onClick={() => (removing ? remove.mutate(removing) : undefined)}
            >
              {t("remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
