"use client";

import { EnvelopeSimple, SignOut, UserCircle } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiRequest } from "@/lib/api-client";
import { clearDeviceData } from "@/lib/device/clear";
import { okSchema } from "@/shared/api/common";
import type { MeResponse } from "@/shared/api/me";

/**
 * Account menu: My invites, Account, Sign out. Signing out clears this device first, then every
 * cached query, then goes to sign-in.
 */
export function UserMenu({
  me,
  onSignedOut,
}: {
  me: MeResponse;
  onSignedOut?: () => void;
}) {
  const t = useTranslations("Shell");
  const router = useRouter();
  const queryClient = useQueryClient();
  const signOut = useMutation({
    mutationFn: async () => {
      // This device forgets the person first: a shared phone must not show their invites.
      await clearDeviceData();
      return apiRequest("/api/auth/signout", {
        method: "POST",
        schema: okSchema,
      });
    },
    onSuccess: () => {
      queryClient.clear();
      (onSignedOut ?? (() => router.replace("/login")))();
    },
  });
  return (
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
        <DropdownMenuItem asChild>
          <Link href="/invites">
            <EnvelopeSimple weight="bold" aria-hidden />
            {t("myInvites")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account">
            <UserCircle weight="bold" aria-hidden />
            {t("account")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => signOut.mutate()}>
          <SignOut weight="bold" aria-hidden />
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
