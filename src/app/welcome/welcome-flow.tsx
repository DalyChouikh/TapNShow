"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UserCircle } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sticker } from "@/components/ui/sticker";
import { ME_QUERY_KEY, useMe } from "@/hooks/use-me";
import { DEVICE_KEYS } from "@/config/members";
import { apiRequest } from "@/lib/api-client";
import { clearDeviceData } from "@/lib/device/clear";
import { readDeviceValue, writeDeviceValue } from "@/lib/device/storage";
import { resolvePostSignInPath } from "@/lib/post-sign-in";
import { safeNextPath } from "@/lib/safe-next-path";
import { okSchema } from "@/shared/api/common";
import { displayNameSchema } from "@/shared/api/me";

const nameFormSchema = z.object({ displayName: displayNameSchema });
type NameForm = z.input<typeof nameFormSchema>;

/** After sign-in: ask for a name once (spec §7.1), then go to `next`, the last workspace, or `/invites`. */
export function WelcomeFlow() {
  const t = useTranslations("Welcome");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));
  const queryClient = useQueryClient();
  const me = useMe();
  const form = useForm<NameForm>({ resolver: zodResolver(nameFormSchema) });
  const save = useMutation({
    mutationFn: (values: NameForm) =>
      apiRequest("/api/me", {
        method: "PATCH",
        body: values,
        schema: okSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
  });

  const ready = me.data?.profile.displayName ? me.data : null;
  useEffect(() => {
    if (!ready) {
      return;
    }
    let live = true;
    void (async () => {
      // Another person used this device: their saved invites, preferences and reminders go
      // before this person sees anything (spec §11 Push privacy). The same person keeps theirs.
      if (readDeviceValue(DEVICE_KEYS.owner, z.string()) !== ready.userId) {
        await clearDeviceData();
        writeDeviceValue(DEVICE_KEYS.owner, ready.userId);
      }
      if (live) {
        router.replace(resolvePostSignInPath(ready, next));
      }
    })();
    return () => {
      live = false;
    };
  }, [ready, next, router]);

  if (!me.data || ready) {
    return <Skeleton className="h-48 w-full" />;
  }
  return (
    <Card as="section" className="flex flex-col gap-4">
      <Sticker tone="info">
        <UserCircle weight="bold" />
      </Sticker>
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <form
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
        noValidate
      >
        <Input
          id="display-name"
          autoComplete="name"
          label={t("nameLabel")}
          hint={t("hint")}
          error={
            form.formState.errors.displayName ? t("invalidName") : undefined
          }
          {...form.register("displayName")}
        />
        <Button
          type="submit"
          tone="primary"
          size="lg"
          disabled={save.isPending}
        >
          {tCommon("continue")}
        </Button>
      </form>
    </Card>
  );
}
