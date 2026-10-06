"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ME_QUERY_KEY } from "@/hooks/use-me";
import { apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import { displayNameSchema } from "@/shared/api/me";

const schema = z.object({ displayName: displayNameSchema });
type Values = z.input<typeof schema>;

/** Edit your display name (shown to organizers and teammates). */
export function ProfileDialog({
  open,
  onOpenChange,
  currentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string | null;
}) {
  const t = useTranslations("Profile");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <ProfileForm
          initialName={currentName ?? ""}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mounted each time the dialog opens: the name it starts from is read once, so a background
 * refetch of the profile never overwrites what the user is typing.
 */
function ProfileForm({
  initialName,
  onDone,
}: {
  initialName: string;
  onDone: () => void;
}) {
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
      onDone();
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
      <DialogFooter>
        <Button onClick={onDone}>{tCommon("cancel")}</Button>
        <Button type="submit" tone="primary" disabled={save.isPending}>
          {tCommon("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
