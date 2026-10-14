"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ME_QUERY_KEY } from "@/hooks/use-me";
import { apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import { displayNameSchema } from "@/shared/api/me";

const schema = z.object({ displayName: displayNameSchema });
type Values = z.input<typeof schema>;

/**
 * Edit your display name (shown to organizers and teammates). The name it starts from is read
 * once, so a background refetch of the profile never overwrites what the person is typing.
 */
export function DisplayNameForm({ initialName }: { initialName: string }) {
  const t = useTranslations("Profile");
  const tCommon = useTranslations("Common");
  const tWelcome = useTranslations("Welcome");
  const queryClient = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { displayName: initialName },
  });
  const save = useMutation({
    mutationFn: (values: Values) =>
      apiRequest("/api/me", {
        method: "PATCH",
        body: values,
        schema: okSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      toast(t("saved"));
    },
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
      noValidate
    >
      <Input
        id="profile-name"
        autoComplete="name"
        label={t("nameLabel")}
        error={
          form.formState.errors.displayName
            ? tWelcome("invalidName")
            : undefined
        }
        {...form.register("displayName")}
      />
      <Button
        type="submit"
        tone="primary"
        className="self-start"
        disabled={save.isPending}
      >
        {tCommon("save")}
      </Button>
    </form>
  );
}
