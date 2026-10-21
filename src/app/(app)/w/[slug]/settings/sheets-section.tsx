"use client";

import { Table } from "@phosphor-icons/react";
import { format } from "date-fns";
import { useSearchParams } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sticker } from "@/components/ui/sticker";
import {
  useRetrySheet,
  useTurnOffSheet,
  useWorkspaceSheet,
} from "@/hooks/use-sheet";
import { errorCodeOf } from "@/lib/api-client";
import { goTo } from "@/lib/navigation";
import { sheetUrl } from "@/lib/sheets/url";
import {
  GOOGLE_RESULT_PARAMS,
  googleConnectHref,
} from "@/shared/api/google-connect";
import { SHEET_RETRYABLE_REASONS, type SheetStatus } from "@/shared/api/sheets";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { GoogleConnectResult } from "./google-connect-result";
import { SettingsSection } from "./settings-section";
import { SheetMyAccess } from "./sheet-my-access";
import { SheetTeamAccess } from "./sheet-team-access";
import { Pill } from "@/components/ui/pill";
import { RELATIVE_TIME_TICK_MS } from "@/config/query";
import { copyText } from "@/lib/clipboard";

type Pending = "connect" | "recreate" | "turnOff" | null;

const TONE: Record<SheetStatus["state"], "primary" | "success" | "warning"> = {
  off: "primary",
  creating: "warning",
  on: "success",
  paused: "warning",
};

/**
 * Settings > Sheets (spec §7.17): the workspace's Google Sheet. Every member sees its state and the
 * link; only the Owner connects, retries, replaces or turns it off, each consequence confirmed.
 */
export function SheetsSection({
  workspace,
  defaultOpen = true,
}: {
  workspace: WorkspaceDetails;
  defaultOpen?: boolean;
}) {
  const t = useTranslations("Settings.sheets");
  const tCommon = useTranslations("Common");
  const tErrors = useTranslations("ApiErrors");
  const formatter = useFormatter();
  const now = useNow({ updateInterval: RELATIVE_TIME_TICK_MS });
  const params = useSearchParams();
  const returning = params.get(GOOGLE_RESULT_PARAMS.purpose) === "sheets";
  // After Try again, follow the status until the sheet is up to date.
  const [following, setFollowing] = useState(false);
  const sheet = useWorkspaceSheet(workspace.slug, {
    following,
    followSharing: true,
  });
  const turnOff = useTurnOffSheet(workspace.slug);
  const retry = useRetrySheet(workspace.slug);
  const [pending, setPending] = useState<Pending>(null);
  const isOwner = workspace.myRole === "owner";
  if (!sheet.data) {
    return <Skeleton className="h-40 w-full" />;
  }
  const status = sheet.data;
  // Sharing with the team (#413): null while switched off, so every line below keeps today's words.
  const sharing = status.sharing;
  const teamShared = sharing !== null && sharing.total > 0;
  const connectHref = googleConnectHref(workspace.slug, "sheets");
  const href = status.spreadsheetId ? sheetUrl(status.spreadsheetId) : null;
  const when = status.syncedAt
    ? formatter.relativeTime(new Date(status.syncedAt), now)
    : null;
  const updated = when ? t("updatedAgo", { when }) : t("neverUpdated");
  const copy = async (link: string) => {
    if (await copyText(link)) {
      toast.success(t("copied"));
    } else {
      toast.error(tCommon("copyLinkFailed"));
    }
  };
  const failed = (error: Error) => toast.error(tErrors(errorCodeOf(error)));
  // Also while the sheet is being created: one that never gets made must not leave the Owner stuck.
  const turnOffButton = (
    <Button tone="danger" onClick={() => setPending("turnOff")}>
      {t("turnOff")}
    </Button>
  );
  const openLink = (link: string) => (
    <Button asChild tone="primary">
      <a href={link} target="_blank" rel="noopener noreferrer">
        {t("open")}
      </a>
    </Button>
  );

  return (
    <SettingsSection
      id="sheets"
      title={t("title")}
      defaultOpen={defaultOpen}
      forceOpen={returning}
      className="gap-3"
      icon={
        <Sticker tone={TONE[status.state]}>
          <Table weight="bold" />
        </Sticker>
      }
    >
      <GoogleConnectResult purpose="sheets" account={status.accountEmail} />
      {!isOwner ? (
        <div className="flex flex-col gap-2">
          {status.state === "off" ? (
            <p>{t("viewerOff", { owner: status.ownerName })}</p>
          ) : status.state === "paused" ? (
            <p>{t("viewerPaused")}</p>
          ) : status.state === "creating" || !href ? (
            <p>{t("creating")}</p>
          ) : (
            <>
              <p>{t("viewerOn", { when: when ?? t("neverUpdated") })}</p>
              {openLink(href)}
              {sharing ? (
                <SheetMyAccess sharing={sharing} ownerName={status.ownerName} />
              ) : (
                <p className="text-sm text-muted-ink">
                  {t("viewerAccess", { owner: status.ownerName })}
                </p>
              )}
            </>
          )}
        </div>
      ) : status.state === "off" ? (
        <div className="flex flex-col gap-2">
          <p>{t(sharing ? "offBodyTeam" : "offBody")}</p>
          <Button tone="primary" onClick={() => setPending("connect")}>
            {t("connect")}
          </Button>
          <p className="text-sm text-muted-ink">{t("tipGroup")}</p>
        </div>
      ) : status.state === "creating" ? (
        <div className="flex flex-col gap-2">
          <p className="font-bold">{t("creating")}</p>
          {turnOffButton}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <p className="font-bold break-words">
              {t("fileName", { workspace: workspace.name })}
            </p>
            {status.accountEmail && status.createdAt ? (
              <p className="text-sm break-words text-muted-ink">
                {t("where", {
                  account: status.accountEmail,
                  name: status.turnedOnBy,
                  date: format(new Date(status.createdAt), "d MMM yyyy"),
                })}
              </p>
            ) : null}
            <p className="text-sm">
              <Pill
                tone={
                  status.state === "paused"
                    ? "warning"
                    : status.behind
                      ? "info"
                      : "success"
                }
              >
                {status.state === "paused"
                  ? t("paused")
                  : status.behind
                    ? t("updating")
                    : t("upToDate")}
              </Pill>{" "}
              {status.state === "paused" ? null : updated}
            </p>
          </div>
          {status.state === "paused" && status.pausedReason ? (
            <>
              <p className="text-sm">
                {t(`pausedLine.${status.pausedReason}`)}
              </p>
              {SHEET_RETRYABLE_REASONS.has(status.pausedReason) ? (
                <Button
                  tone="primary"
                  disabled={retry.isPending}
                  onClick={() =>
                    retry.mutate(undefined, {
                      onSuccess: () => setFollowing(true),
                      onError: failed,
                    })
                  }
                >
                  {t("tryAgain")}
                </Button>
              ) : null}
              {status.pausedReason === "access_lost" ? (
                <Button asChild tone="primary">
                  <a href={connectHref}>{t("reconnect")}</a>
                </Button>
              ) : null}
              <Button
                tone={
                  status.pausedReason === "deleted" ||
                  status.pausedReason === "full"
                    ? "primary"
                    : undefined
                }
                onClick={() => setPending("recreate")}
              >
                {t("recreate")}
              </Button>
            </>
          ) : href ? (
            <>
              {sharing ? <SheetTeamAccess sharing={sharing} /> : null}
              {openLink(href)}
              <Button onClick={() => void copy(href)}>{t("copy")}</Button>
              <p className="text-sm text-muted-ink">
                {sharing ? null : <>{t("shareTip")} </>}
                {t("replacedTip")}
              </p>
            </>
          ) : null}
          {turnOffButton}
        </div>
      )}
      <ConfirmDialog
        open={pending === "connect"}
        onOpenChange={(open) => !open && setPending(null)}
        title={t("connectTitle", { workspace: workspace.name })}
        description={t("connectBody")}
        confirmLabel={t("continue")}
        onConfirm={() => goTo(connectHref)}
      >
        {sharing ? (
          <p className="text-sm">
            {sharing.teamCount > 0
              ? t("team.connect", { count: sharing.teamCount })
              : t("team.connectNone")}
          </p>
        ) : null}
        <p className="text-sm text-muted-ink">{t("connectNote")}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={pending === "recreate"}
        onOpenChange={(open) => !open && setPending(null)}
        title={t("recreateTitle")}
        description={t(teamShared ? "team.recreate" : "recreateBody")}
        confirmLabel={t("continue")}
        onConfirm={() =>
          goTo(googleConnectHref(workspace.slug, "sheets", { replace: true }))
        }
      >
        <p className="text-sm text-muted-ink">{t("connectNote")}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={pending === "turnOff"}
        onOpenChange={(open) => !open && setPending(null)}
        title={t("turnOffTitle")}
        description={t(teamShared ? "team.turnOff" : "turnOffBody", {
          account: status.accountEmail ?? "",
        })}
        confirmLabel={t("turnOff")}
        tone="danger"
        pending={turnOff.isPending}
        onConfirm={() =>
          turnOff.mutate(undefined, {
            onSuccess: () => {
              setPending(null);
              toast(t("turnedOff"));
            },
            onError: (error) => {
              setPending(null);
              failed(error);
            },
          })
        }
      />
    </SettingsSection>
  );
}
