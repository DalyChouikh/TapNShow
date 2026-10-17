"use client";

import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminAdmins } from "@/hooks/use-admin";
import { useMe } from "@/hooks/use-me";
import { AdminList } from "./admin-list";
import { InviteAdminButton } from "./invite-admin-dialog";
import { LoadError } from "@/components/errors/load-error";
import { WaitingInvites } from "./waiting-invites";

/**
 * `/admin/admins` (spec §7.19): who runs the platform. The platform owner also adds admins and
 * handles the waiting invites; an admin sees the list only.
 */
export function AdminAdminsView() {
  const t = useTranslations("Admin.admins");
  const me = useMe();
  const admins = useAdminAdmins();
  const isOwner = me.data?.platformRole === "owner";
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      {admins.isError && !admins.data ? (
        <LoadError onRetry={() => void admins.refetch()} />
      ) : !admins.data || !me.data ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <>
          {isOwner ? <InviteAdminButton /> : null}
          <AdminList admins={admins.data.admins} viewerId={me.data.userId} />
          {isOwner ? <WaitingInvites invites={admins.data.invites} /> : null}
        </>
      )}
    </div>
  );
}
