"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
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
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-bold">{t("roleLabel")}</legend>
              <label className="flex min-h-11 items-center gap-2">
                <input type="radio" value="viewer" {...form.register("role")} />
                {t("roleViewer")}
              </label>
              {workspace.myRole === "owner" ? (
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="radio"
                    value="admin"
                    {...form.register("role")}
                  />
                  {t("roleAdmin")}
                </label>
              ) : null}
            </fieldset>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-bold">
                {t("deliveryLabel")}
              </legend>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  value="email"
                  {...form.register("delivery")}
                />
                {t("deliveryEmail")}
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  value="link"
                  {...form.register("delivery")}
                />
                {t("deliveryLink")}
              </label>
            </fieldset>
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
