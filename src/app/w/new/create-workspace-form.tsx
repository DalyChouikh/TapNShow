"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UsersThree } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { TimezonePicker } from "@/components/forms/timezone-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sticker } from "@/components/ui/sticker";
import { ME_QUERY_KEY } from "@/hooks/use-me";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { browserTimezone } from "@/lib/timezones";
import {
  createWorkspaceBodySchema,
  createWorkspaceResponseSchema,
} from "@/shared/api/workspaces";

type FormValues = z.input<typeof createWorkspaceBodySchema>;

/** `/w/new`: name + timezone (pre-filled from the device). */
export function CreateWorkspaceForm() {
  const t = useTranslations("CreateWorkspace");
  const tErrors = useTranslations("ApiErrors");
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(createWorkspaceBodySchema),
    defaultValues: { name: "", timezone: browserTimezone() },
  });
  const create = useMutation({
    mutationFn: (values: FormValues) =>
      apiRequest("/api/workspaces", {
        method: "POST",
        body: values,
        schema: createWorkspaceResponseSchema,
      }),
    onSuccess: async ({ slug }) => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      router.push(`/w/${slug}`);
    },
  });
  const serverError = create.error
    ? tErrors(
        create.error instanceof ApiClientError ? create.error.code : "internal",
      )
    : undefined;

  return (
    <Card as="section" className="flex flex-col gap-4">
      <Sticker tone="success">
        <UsersThree weight="bold" />
      </Sticker>
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-muted-ink">{t("intro")}</p>
      <form
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => create.mutate(values))}
        noValidate
      >
        <Input
          id="workspace-name"
          label={t("nameLabel")}
          placeholder={t("namePlaceholder")}
          error={form.formState.errors.name ? t("invalidName") : undefined}
          {...form.register("name")}
        />
        <Controller
          control={form.control}
          name="timezone"
          render={({ field }) => (
            <TimezonePicker
              id="workspace-timezone"
              label={t("timezoneLabel")}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
        <p className="text-sm text-muted-ink">{t("timezoneHint")}</p>
        {serverError ? (
          <p role="alert" className="text-sm font-bold text-ink">
            {serverError}
          </p>
        ) : null}
        <Button
          type="submit"
          tone="primary"
          size="lg"
          disabled={create.isPending}
        >
          {t("submit")}
        </Button>
      </form>
    </Card>
  );
}
