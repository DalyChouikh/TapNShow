"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { TimezonePicker } from "@/components/forms/timezone-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ME_QUERY_KEY } from "@/hooks/use-me";
import { workspaceQueryKey } from "@/hooks/use-workspace";
import { apiRequest, errorCodeOf } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import {
  timezoneSchema,
  workspaceNameSchema,
  type WorkspaceDetails,
} from "@/shared/api/workspaces";
import { SettingsSection } from "./settings-section";

const schema = z.object({
  name: workspaceNameSchema,
  timezone: timezoneSchema,
});
type Values = z.input<typeof schema>;

/** Settings > General: name and timezone (Owner/Admin), read-only for Viewers. */
export function GeneralSection({
  workspace,
  defaultOpen = true,
}: {
  workspace: WorkspaceDetails;
  defaultOpen?: boolean;
}) {
  const t = useTranslations("Settings.general");
  const tErrors = useTranslations("ApiErrors");
  const queryClient = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    // Read once: a refetch must not overwrite what the user is typing (the page keys this by id).
    defaultValues: { name: workspace.name, timezone: workspace.timezone },
  });
  const save = useMutation({
    mutationFn: (values: Values) =>
      apiRequest(`/api/workspaces/${workspace.slug}`, {
        method: "PATCH",
        body: values,
        schema: okSchema,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKey(workspace.slug),
        }),
        queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
      ]);
      toast(t("saved"));
    },
    onError: (error) => toast.error(tErrors(errorCodeOf(error))),
  });

  return (
    <SettingsSection id="general" title={t("title")} defaultOpen={defaultOpen}>
      {workspace.myRole === "viewer" ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="font-bold">{t("nameLabel")}</dt>
            <dd>{workspace.name}</dd>
            <dt className="font-bold">{t("timezoneLabel")}</dt>
            <dd>{workspace.timezone}</dd>
          </dl>
          <p className="text-sm text-muted-ink">{t("readOnly")}</p>
        </>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
          noValidate
        >
          <Input
            id="settings-name"
            label={t("nameLabel")}
            {...form.register("name")}
          />
          <Controller
            control={form.control}
            name="timezone"
            render={({ field }) => (
              <TimezonePicker
                id="settings-timezone"
                label={t("timezoneLabel")}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Button type="submit" tone="primary" disabled={save.isPending}>
            {t("save")}
          </Button>
        </form>
      )}
    </SettingsSection>
  );
}
