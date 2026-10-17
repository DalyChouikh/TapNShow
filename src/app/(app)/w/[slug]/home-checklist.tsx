"use client";

import {
  EnvelopeSimple,
  Eye,
  Table,
  UploadSimple,
  UserPlus,
  type Icon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Sticker } from "@/components/ui/sticker";
import { settingsPath } from "@/lib/with-query";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import {
  type HomeSetup,
  SETUP_STEPS,
  type SetupStepKey,
} from "./use-home-setup";

/** Setup once its data has loaded. */
export type ReadySetup = Extract<HomeSetup, { state: "ready" }>;

const STEP_UI: Record<
  SetupStepKey,
  { icon: Icon; href: (slug: string) => string }
> = {
  importMembers: { icon: UploadSimple, href: (slug) => `/w/${slug}/lists` },
  connectGmail: {
    icon: EnvelopeSimple,
    href: (slug) => settingsPath(slug, "sending"),
  },
  inviteCommittee: {
    icon: UserPlus,
    href: (slug) => settingsPath(slug, "people"),
  },
  // Settings, not Google: the privacy text is always read before connecting.
  connectSheets: { icon: Table, href: (slug) => settingsPath(slug, "sheets") },
};

const REQUIRED = SETUP_STEPS.filter((step) => step.required);

/**
 * Home's "Get set up" (spec §7.1, design §2.6): each step shows Done or its action, required steps
 * first, until members and Gmail are in; then the card is gone. Admins are told to ask the Owner
 * for the Owner's steps. Viewers see a short welcome instead, until setup is done.
 */
export function HomeChecklist({
  workspace,
  setup,
}: {
  workspace: WorkspaceDetails;
  setup: ReadySetup;
}) {
  const t = useTranslations("WorkspaceHome");
  if (setup.complete) {
    return null;
  }
  if (workspace.myRole === "viewer") {
    return (
      <Card as="section" className="flex flex-col gap-3">
        <Sticker tone="info">
          <Eye weight="bold" />
        </Sticker>
        <h2 className="font-display text-2xl">
          {t("viewerTitle", { workspace: workspace.name })}
        </h2>
        <p className="text-muted-ink">{t("viewerBody")}</p>
      </Card>
    );
  }
  const neededDone = REQUIRED.filter((step) => setup.done[step.key]).length;
  const needed = t("neededProgress", {
    done: neededDone,
    total: REQUIRED.length,
  });
  return (
    <Card as="section" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl">{t("checklistTitle")}</h2>
        <p className="text-sm text-muted-ink">{needed}</p>
      </div>
      <ProgressBar label={needed} value={neededDone} max={REQUIRED.length} />
      <ul className="flex flex-col gap-3">
        {SETUP_STEPS.map((step) => {
          const { icon: Glyph, href } = STEP_UI[step.key];
          return (
            <li key={step.key} className="flex items-center gap-3">
              <Sticker tone="primary">
                <Glyph weight="bold" />
              </Sticker>
              <div className="min-w-0 flex-1">
                <p className="font-bold break-words">{t(step.key)}</p>
                <p className="text-sm text-muted-ink">{t(`${step.key}Hint`)}</p>
              </div>
              {setup.done[step.key] ? (
                <Pill tone="success">{t("done")}</Pill>
              ) : step.ownerOnly && workspace.myRole !== "owner" ? (
                <span className="max-w-32 text-right text-sm text-muted-ink">
                  {t("askOwner", { owner: setup.ownerName })}
                </span>
              ) : (
                <Button asChild tone={step.required ? "primary" : "surface"}>
                  <Link href={href(workspace.slug)}>
                    {t(`${step.key}Action`)}
                  </Link>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted-ink">{t("checklistFooter")}</p>
    </Card>
  );
}
