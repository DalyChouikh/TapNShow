"use client";

import { useFormatter, useNow, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RELATIVE_TIME_TICK_MS } from "@/config/query";
import { useRenewAdminInvite, useRevokeAdminInvite } from "@/hooks/use-admin";
import { errorCodeOf } from "@/lib/api-client";
import type { AdminAdmins } from "@/shared/api/admin";
import { useInviteResultMessage } from "./invite-result";

type Invite = AdminAdmins["invites"][number];

/**
 * The platform owner's waiting admin invites (spec §7.19): Copy link and Resend each make a fresh
 * link with 7 more days (the old one stops working); Revoke is confirmed first.
 */
export function WaitingInvites({ invites }: { invites: Invite[] }) {
  const t = useTranslations("Admin.admins");
  const tErrors = useTranslations("ApiErrors");
  const format = useFormatter();
  const now = useNow({ updateInterval: RELATIVE_TIME_TICK_MS });
  const renew = useRenewAdminInvite();
  const revoke = useRevokeAdminInvite();
  const announce = useInviteResultMessage();
  const [revoking, setRevoking] = useState<Invite | null>(null);
  const failed = (error: Error) => toast.error(tErrors(errorCodeOf(error)));

  if (invites.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="admin-invites" className="flex flex-col gap-3">
      <h2 id="admin-invites" className="font-display text-xl">
        {t("waiting")}
      </h2>
      <ul className="flex flex-col gap-3">
        {invites.map((invite) => (
          <li key={invite.id}>
            <Card className="flex flex-col gap-3 p-3">
              <div className="flex flex-col">
                <span className="font-bold break-all">{invite.email}</span>
                <span className="text-sm text-muted-ink">
                  {t("expires", {
                    when: format.relativeTime(new Date(invite.expiresAt), now),
                  })}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={renew.isPending}
                  onClick={() =>
                    renew.mutate(
                      { id: invite.id, delivery: "link" },
                      { onSuccess: announce, onError: failed },
                    )
                  }
                >
                  {t("copyLink")}
                </Button>
                <Button
                  disabled={renew.isPending}
                  onClick={() =>
                    renew.mutate(
                      { id: invite.id, delivery: "email" },
                      { onSuccess: announce, onError: failed },
                    )
                  }
                >
                  {t("resend")}
                </Button>
                <Button tone="danger" onClick={() => setRevoking(invite)}>
                  {t("revoke")}
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t("revokeTitle", { email: revoking?.email ?? "" })}
        description={t("revokeBody")}
        confirmLabel={t("revoke")}
        tone="danger"
        pending={revoke.isPending}
        onConfirm={() => {
          if (!revoking) {
            return;
          }
          revoke.mutate(revoking.id, {
            onSuccess: () => {
              setRevoking(null);
              toast(t("revoked"));
            },
            onError: (error) => {
              setRevoking(null);
              failed(error);
            },
          });
        }}
      />
    </section>
  );
}
