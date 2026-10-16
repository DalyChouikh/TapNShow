"use client";

import { ShieldStar } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  InviteClosedCard,
  InviteWrongAccountCard,
} from "@/components/invites/invite-cards";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sticker } from "@/components/ui/sticker";
import { useAcceptAdminInvite, useAdminInvitePreview } from "@/hooks/use-admin";
import { ME_QUERY_KEY } from "@/hooks/use-me";
import { apiRequest, errorCodeOf } from "@/lib/api-client";
import { loginPathFor } from "@/lib/auth-redirect";
import { okSchema } from "@/shared/api/common";

/**
 * `/admin/join/[token]` (spec §7.19): the signed-in person whose address the invite names accepts
 * it and opens the admin area. The page needs a session (the proxy sends anyone signed out to
 * sign-in first, and back here after).
 */
export function AdminJoin() {
  const t = useTranslations("Admin.join");
  const tErrors = useTranslations("ApiErrors");
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const preview = useAdminInvitePreview(token);
  const accept = useAcceptAdminInvite();
  const switchAccount = useMutation({
    mutationFn: () =>
      apiRequest("/api/auth/signout", { method: "POST", schema: okSchema }),
    onSuccess: () =>
      window.location.assign(loginPathFor(`/admin/join/${token}`)),
  });

  if (!preview.data) {
    return preview.isError ? (
      <Card as="section">
        <p role="alert" className="font-bold">
          {tErrors(errorCodeOf(preview.error))}
        </p>
      </Card>
    ) : (
      <Skeleton className="h-48 w-full" />
    );
  }
  const { status, maskedEmail } = preview.data;
  if (status === "ready") {
    return (
      <Card as="section" className="flex flex-col gap-3">
        <Sticker tone="success">
          <ShieldStar weight="bold" />
        </Sticker>
        <h1 className="font-display text-2xl">{t("readyTitle")}</h1>
        <p>{t("readyBody")}</p>
        {accept.error ? (
          <p role="alert" className="font-bold">
            {tErrors(errorCodeOf(accept.error))}
          </p>
        ) : null}
        <Button
          tone="primary"
          size="lg"
          disabled={accept.isPending}
          onClick={() =>
            accept.mutate(token, {
              onSuccess: async () => {
                await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
                router.push("/admin");
              },
            })
          }
        >
          {t("accept")}
        </Button>
      </Card>
    );
  }
  if (status === "wrong_account") {
    return (
      <InviteWrongAccountCard
        email={maskedEmail ?? ""}
        pending={switchAccount.isPending}
        onSwitch={() => switchAccount.mutate()}
      />
    );
  }
  if (status === "already_admin") {
    return (
      <Card as="section" className="flex flex-col gap-3">
        <h1 className="font-display text-2xl">{t("already")}</h1>
        <Button asChild tone="primary">
          <Link href="/admin">{t("open")}</Link>
        </Button>
      </Card>
    );
  }
  return <InviteClosedCard status={status} />;
}
