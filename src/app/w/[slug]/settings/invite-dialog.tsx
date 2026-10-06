"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { invitesQueryKey } from "@/hooks/use-invites";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import {
  createInviteBodySchema,
  inviteDeliveredSchema,
} from "@/shared/api/invites";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

type Values = z.input<typeof createInviteBodySchema>;

/** Invite someone by email or copied link (spec §7.13). Admin role is offered to the Owner only. */
export function InviteDialog({
  open,
  onOpenChange,
  workspace,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: WorkspaceDetails;
}) {
  const t = useTranslations("Invites");
  const tErrors = useTranslations("ApiErrors");
  const queryClient = useQueryClient();
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(createInviteBodySchema),
    defaultValues: { email: "", role: "viewer", delivery: "email" },
  });
  const base = `/api/workspaces/${workspace.slug}/invites`;
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: invitesQueryKey(workspace.slug),
    });

  const create = useMutation({
    mutationFn: (values: Values) =>
      apiRequest(base, {
        method: "POST",
        body: values,
        schema: inviteDeliveredSchema,
      }),
    onSuccess: async (result, values) => {
      await refresh();
      if (result.delivery === "link") {
        setLink({ url: result.link, email: values.email.trim().toLowerCase() });
      } else {
        toast(t("sent", { email: values.email.trim().toLowerCase() }));
        close(false);
      }
    },
  });
  const copyInstead = useMutation({
    mutationFn: (inviteId: string) =>
      apiRequest(`${base}/${inviteId}/renew`, {
        method: "POST",
        body: { delivery: "link" },
        schema: inviteDeliveredSchema,
      }),
    onSuccess: async (result) => {
      await refresh();
      if (result.delivery === "link") {
        setLink({
          url: result.link,
          email: form.getValues("email").trim().toLowerCase(),
        });
      }
    },
  });

  function close(next: boolean) {
    if (!next) {
      setLink(null);
      form.reset();
      create.reset();
      copyInstead.reset();
    }
    onOpenChange(next);
  }

  const failure = create.error instanceof ApiClientError ? create.error : null;
  const fallbackInviteId = failure?.details?.inviteId;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("dialogTitle", { workspace: workspace.name })}
          </DialogTitle>
        </DialogHeader>
        {link ? (
          <div className="flex flex-col gap-3">
            <Input
              id="invite-link"
              label={t("linkLabel")}
              hint={t("linkHint", { email: link.email })}
              value={link.url}
              readOnly
              onFocus={(event) => event.target.select()}
            />
            <DialogFooter>
              <Button
                tone="primary"
                onClick={async () => {
                  await navigator.clipboard.writeText(link.url);
                  toast(t("copied", { email: link.email }));
                }}
              >
                {t("copyLink")}
              </Button>
              <Button onClick={() => close(false)}>{t("done")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={form.handleSubmit((values) => create.mutate(values))}
            noValidate
          >
            <Input
              id="invite-email"
              type="email"
              autoComplete="off"
              label={t("emailLabel")}
              {...form.register("email")}
            />
            <div className="flex flex-col gap-2">
              <span id="invite-role-label" className="text-sm font-bold">
                {t("roleLabel")}
              </span>
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <RadioGroup
                    aria-labelledby="invite-role-label"
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <RadioCard value="viewer">{t("roleViewer")}</RadioCard>
                    {workspace.myRole === "owner" ? (
                      <RadioCard value="admin">{t("roleAdmin")}</RadioCard>
                    ) : null}
                  </RadioGroup>
                )}
              />
            </div>
            <div className="flex flex-col gap-2">
              <span id="invite-delivery-label" className="text-sm font-bold">
                {t("deliveryLabel")}
              </span>
              <Controller
                control={form.control}
                name="delivery"
                render={({ field }) => (
                  <RadioGroup
                    aria-labelledby="invite-delivery-label"
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <RadioCard value="email">{t("deliveryEmail")}</RadioCard>
                    <RadioCard value="link">{t("deliveryLink")}</RadioCard>
                  </RadioGroup>
                )}
              />
            </div>
            {create.error ? (
              <p role="alert" className="text-sm font-bold">
                {tErrors(failure ? failure.code : "internal")}
              </p>
            ) : null}
            <DialogFooter>
              {fallbackInviteId ? (
                <Button
                  tone="warning"
                  disabled={copyInstead.isPending}
                  onClick={() => copyInstead.mutate(fallbackInviteId)}
                >
                  {t("copyInstead")}
                </Button>
              ) : null}
              <Button type="submit" tone="primary" disabled={create.isPending}>
                {t("submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
