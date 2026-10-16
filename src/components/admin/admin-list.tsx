"use client";

import { DotsThreeVertical } from "@phosphor-icons/react";
import { format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Pill } from "@/components/ui/pill";
import { useRemoveAdmin } from "@/hooks/use-admin";
import { errorCodeOf } from "@/lib/api-client";
import type { AdminAdmins } from "@/shared/api/admin";

type Admin = AdminAdmins["admins"][number];

/**
 * The platform owner and the admins (spec §7.19), owner first, addresses masked. Only the owner
 * can remove an admin (confirmed first); nobody can remove the owner.
 */
export function AdminList({
  admins,
  viewerId,
}: {
  admins: AdminAdmins["admins"];
  viewerId: string;
}) {
  const t = useTranslations("Admin.admins");
  const tErrors = useTranslations("ApiErrors");
  const remove = useRemoveAdmin();
  const [removing, setRemoving] = useState<Admin | null>(null);
  const viewerIsOwner = admins.some(
    (admin) => admin.userId === viewerId && admin.role === "owner",
  );
  const sorted = [...admins].sort(
    (a, b) => Number(b.role === "owner") - Number(a.role === "owner"),
  );
  const nameOf = (admin: Admin) => admin.name ?? admin.email;
  const sinceDate = (admin: Admin) =>
    format(parseISO(admin.since), "d MMM yyyy");

  return (
    <>
      <ul className="flex flex-col gap-3">
        {sorted.map((admin) => (
          <li key={admin.userId}>
            <Card className="flex items-start gap-3 p-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-bold break-words">{nameOf(admin)}</span>
                  {admin.userId === viewerId ? (
                    <Pill tone="neutral">{t("you")}</Pill>
                  ) : null}
                  <Pill tone={admin.role === "owner" ? "danger" : "primary"}>
                    {admin.role === "owner" ? t("owner") : t("admin")}
                  </Pill>
                </span>
                <span className="text-sm text-muted-ink">
                  {admin.role === "owner"
                    ? t("ownerHint")
                    : admin.name
                      ? t("since", {
                          email: admin.email,
                          date: sinceDate(admin),
                        })
                      : t("sinceOnly", {
                          date: sinceDate(admin),
                        })}
                </span>
              </div>
              {viewerIsOwner && admin.role !== "owner" ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={t("actionsFor", { name: nameOf(admin) })}
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-control"
                  >
                    <DotsThreeVertical weight="bold" aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setRemoving(admin)}>
                      {t("remove")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("removeTitle", { name: removing ? nameOf(removing) : "" })}
        description={t("removeBody")}
        confirmLabel={t("remove")}
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => {
          if (!removing) {
            return;
          }
          const name = nameOf(removing);
          remove.mutate(removing.userId, {
            onSuccess: () => {
              setRemoving(null);
              toast(t("removed", { name }));
            },
            onError: (error) => {
              setRemoving(null);
              toast.error(tErrors(errorCodeOf(error)));
            },
          });
        }}
      />
    </>
  );
}
