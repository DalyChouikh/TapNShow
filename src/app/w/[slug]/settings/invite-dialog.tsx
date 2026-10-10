"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { EmailChipsInput } from "@/components/forms/email-chips-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { INVITE_BATCH_MAX } from "@/config/invites";
import { invitesQueryKey } from "@/hooks/use-invites";
import { ApiClientError, apiRequest, errorCodeOf } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  createInviteBodySchema,
  inviteBatchResponseSchema,
  inviteDeliveredSchema,
  type InviteResult,
} from "@/shared/api/invites";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

type Values = z.input<typeof createInviteBodySchema>;

const STATUS_KEY = {
  sent: "statusSent",
  link: "statusLink",
  already_member: "statusAlreadyMember",
  email_limit: "statusEmailLimit",
  email_failed: "statusEmailFailed",
  error: "statusError",
} as const;

const STATUS_FILL: Record<InviteResult["status"], string> = {
  sent: "bg-fill-success",
  link: "bg-fill-success",
  already_member: "bg-fill-neutral",
  email_limit: "bg-fill-warning",
  email_failed: "bg-fill-warning",
  error: "bg-fill-danger",
};

/**
 * Invite one or several people (spec §7.13). Each address gets its own email-bound invite; the
 * results list shows what happened per person, with "Copy link" per row and "Copy all links".
 * The Admin role is offered to the Owner only.
 */
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
  const [results, setResults] = useState<InviteResult[] | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(createInviteBodySchema),
    defaultValues: { emails: [], role: "viewer", delivery: "email" },
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
        schema: inviteBatchResponseSchema,
      }),
    onSuccess: async (response) => {
      await refresh();
      setResults(response.results);
    },
  });
  const linkFor = useMutation({
    mutationFn: (result: InviteResult) =>
      apiRequest(`${base}/${result.inviteId}/renew`, {
        method: "POST",
        body: { delivery: "link" },
        schema: inviteDeliveredSchema,
      }),
    onSuccess: async (response, result) => {
      await refresh();
      if (response.delivery === "link") {
        await navigator.clipboard.writeText(response.link);
        toast(t("copied", { email: result.email }));
        setResults(
          (rows) =>
            rows?.map((row) =>
              row.email === result.email
                ? { ...row, status: "link", link: response.link }
                : row,
            ) ?? null,
        );
      }
    },
    onError: (error) => toast.error(tErrors(errorCodeOf(error))),
  });

  function close(next: boolean) {
    if (!next) {
      setResults(null);
      form.reset();
      create.reset();
    }
    onOpenChange(next);
  }

  const copy = async (result: InviteResult) => {
    if (result.link) {
      await navigator.clipboard.writeText(result.link);
      toast(t("copied", { email: result.email }));
    } else {
      linkFor.mutate(result);
    }
  };
  const links = results?.filter((row) => row.link) ?? [];
  const copyAll = async () => {
    await navigator.clipboard.writeText(
      links.map((row) => `${row.email}: ${row.link}`).join("\n"),
    );
    toast(t("copiedAll", { count: links.length }));
  };

  const emailsError = (() => {
    if (!form.formState.errors.emails) {
      return undefined;
    }
    const emails = form.getValues("emails");
    if (emails.length === 0) {
      return t("noEmails");
    }
    return emails.length > INVITE_BATCH_MAX
      ? t("tooMany", { max: INVITE_BATCH_MAX })
      : t("invalidEmails");
  })();

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {results
              ? t("resultsTitle", { workspace: workspace.name })
              : t("dialogTitle", { workspace: workspace.name })}
          </DialogTitle>
          {results && links.length > 0 ? (
            <DialogDescription>{t("linksHint")}</DialogDescription>
          ) : null}
        </DialogHeader>
        {results ? (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2">
              {results.map((result) => (
                <li
                  key={result.email}
                  className="flex items-center gap-2 rounded-control border-2 border-outline bg-surface px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{result.email}</p>
                    <span
                      className={cn(
                        "inline-flex rounded-full border-2 border-outline px-2 text-xs font-bold text-on-fill",
                        STATUS_FILL[result.status],
                      )}
                    >
                      {t(STATUS_KEY[result.status])}
                    </span>
                  </div>
                  {result.inviteId && result.status !== "sent" ? (
                    <Button
                      aria-label={t("copyLinkFor", { email: result.email })}
                      disabled={linkFor.isPending}
                      onClick={() => void copy(result)}
                    >
                      {t("copyLink")}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            <DialogFooter>
              {links.length > 1 ? (
                <Button tone="primary" onClick={() => void copyAll()}>
                  {t("copyAll")}
                </Button>
              ) : null}
              <Button onClick={() => close(false)}>{t("done")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={form.handleSubmit((values) => create.mutate(values))}
            noValidate
          >
            <Controller
              control={form.control}
              name="emails"
              render={({ field }) => (
                <EmailChipsInput
                  id="invite-emails"
                  label={t("emailsLabel")}
                  hint={t("emailsHint", { max: INVITE_BATCH_MAX })}
                  error={emailsError}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
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
                {tErrors(
                  create.error instanceof ApiClientError
                    ? create.error.code
                    : "internal",
                )}
              </p>
            ) : null}
            <DialogFooter>
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
