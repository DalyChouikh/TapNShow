"use client";

import { EnvelopeOpen, WarningCircle } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sticker } from "@/components/ui/sticker";
import { ME_QUERY_KEY } from "@/hooks/use-me";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { loginPathFor } from "@/lib/auth-redirect";
import { okSchema } from "@/shared/api/common";
import {
  acceptInviteResponseSchema,
  invitePreviewSchema,
} from "@/shared/api/invites";

/** `/invite/[token]` (spec §7.13): sign in first, then accept with the invited email. */
export function InviteAcceptance() {
  const t = useTranslations("InvitePage");
  const tRoles = useTranslations("Shell.roles");
  const tErrors = useTranslations("ApiErrors");
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [signedOut, setSignedOut] = useState(false);
  const loginHref = loginPathFor(`/invite/${token}`);

  const preview = useQuery({
    queryKey: ["invite-preview", token],
    queryFn: () =>
      apiRequest("/api/invites/preview", {
        method: "POST",
        body: { token },
        schema: invitePreviewSchema,
        onUnauthenticated: () => setSignedOut(true),
      }),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () =>
      apiRequest("/api/invites/accept", {
        method: "POST",
        body: { token },
        schema: acceptInviteResponseSchema,
      }),
    onSuccess: async ({ slug }) => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      router.push(`/w/${slug}`);
    },
  });
  const switchAccount = useMutation({
    mutationFn: () =>
      apiRequest("/api/auth/signout", { method: "POST", schema: okSchema }),
    onSuccess: () => window.location.assign(loginHref),
  });

  if (signedOut) {
    return (
      <Card as="section" className="flex flex-col gap-3">
        <Sticker tone="primary">
          <EnvelopeOpen weight="bold" />
        </Sticker>
        <h1 className="font-display text-2xl">{t("signInTitle")}</h1>
        <p className="text-muted-ink">{t("signInBody")}</p>
        <Button asChild tone="primary" size="lg">
          <Link href={loginHref}>{t("signIn")}</Link>
        </Button>
      </Card>
    );
  }
  if (!preview.data) {
    return <Skeleton className="h-48 w-full" />;
  }
  const { status, workspaceName, workspaceSlug, role, maskedEmail } =
    preview.data;

  if (status === "ready") {
    return (
      <Card as="section" className="flex flex-col gap-3">
        <Sticker tone="success">
          <EnvelopeOpen weight="bold" />
        </Sticker>
        <h1 className="font-display text-2xl">
          {t("readyTitle", { workspace: workspaceName ?? "" })}
        </h1>
        <p>{t("readyBody", { role: role ? tRoles(role) : "" })}</p>
        {accept.error ? (
          <p role="alert" className="font-bold">
            {tErrors(
              accept.error instanceof ApiClientError
                ? accept.error.code
                : "internal",
            )}
          </p>
        ) : null}
        <Button
          tone="primary"
          size="lg"
          disabled={accept.isPending}
          onClick={() => accept.mutate()}
        >
          {t("accept")}
        </Button>
      </Card>
    );
  }
  if (status === "wrong_account") {
    return (
      <Card as="section" className="flex flex-col gap-3">
        <Sticker tone="warning">
          <WarningCircle weight="bold" />
        </Sticker>
        <h1 className="font-display text-2xl">
          {t("wrongTitle", { email: maskedEmail ?? "" })}
        </h1>
        <p>{t("wrongBody")}</p>
        <Button
          tone="primary"
          disabled={switchAccount.isPending}
          onClick={() => switchAccount.mutate()}
        >
          {t("switchAccount")}
        </Button>
      </Card>
    );
  }
  if (status === "already_member" && workspaceSlug) {
    return (
      <Card as="section" className="flex flex-col gap-3">
        <h1 className="font-display text-2xl">
          {t("alreadyMember", { workspace: workspaceName ?? "" })}
        </h1>
        <Button asChild tone="primary">
          <Link href={`/w/${workspaceSlug}`}>{t("open")}</Link>
        </Button>
      </Card>
    );
  }
  const message = {
    expired: t("expired"),
    revoked: t("revoked"),
    used: t("used"),
    not_found: t("notFound"),
    already_member: t("notFound"),
  }[status];
  return (
    <Card as="section" className="flex flex-col gap-3">
      <Sticker tone="neutral">
        <WarningCircle weight="bold" />
      </Sticker>
      <p className="font-bold">{message}</p>
    </Card>
  );
}
