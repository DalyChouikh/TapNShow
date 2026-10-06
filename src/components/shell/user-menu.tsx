"use client";

import { SignOut, UserCircle } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import type { MeResponse } from "@/shared/api/me";
import { ProfileDialog } from "./profile-dialog";

/** Account menu: edit name, sign out (clears every cached query, then goes to sign-in). */
export function UserMenu({
  me,
  onSignedOut,
}: {
  me: MeResponse;
  onSignedOut?: () => void;
}) {
  const t = useTranslations("Shell");
  const [profileOpen, setProfileOpen] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();
  const signOut = useMutation({
    mutationFn: () =>
      apiRequest("/api/auth/signout", { method: "POST", schema: okSchema }),
    onSuccess: () => {
      queryClient.clear();
      (onSignedOut ?? (() => router.replace("/login")))();
    },
  });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("userMenuLabel")}
          className="rounded-full"
        >
          <Avatar name={me.profile.displayName} email={me.profile.email} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="truncate">
            {me.profile.displayName ?? me.profile.email}
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
            <UserCircle weight="bold" aria-hidden />
            {t("yourName")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => signOut.mutate()}>
            <SignOut weight="bold" aria-hidden />
            {t("signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        currentName={me.profile.displayName}
      />
    </>
  );
}
