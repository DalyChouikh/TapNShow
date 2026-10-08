"use client";

import { CaretRight, EnvelopeSimple, Warning } from "@phosphor-icons/react";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sticker } from "@/components/ui/sticker";
import { cn } from "@/lib/utils";
import {
  gmailConnectHref,
  useDisconnectGmail,
  useSetSender,
  useWorkspaceSender,
} from "@/hooks/use-sender";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { GmailConnectResult } from "./gmail-connect-result";

type Pending =
  | { kind: "use"; id: string; email: string }
  | { kind: "replace" }
  | { kind: "disconnect"; id: string; email: string; usedBy: string[] }
  | null;

/** Settings > Sending (spec §7.15): the workspace's sender Gmail. Only the Owner changes it. */
export function SendingSection({ workspace }: { workspace: WorkspaceDetails }) {
  const t = useTranslations("Settings.sending");
  const sender = useWorkspaceSender(workspace.slug);
  const setSender = useSetSender(workspace.slug);
  const disconnect = useDisconnectGmail(workspace.slug);
  const [pending, setPending] = useState<Pending>(null);
  const isOwner = workspace.myRole === "owner";
  if (!sender.data) {
    return <Skeleton className="h-40 w-full" />;
  }
  const { sender: current, myConnections, ownerName } = sender.data;
  const connectHref = gmailConnectHref(workspace.slug);
  const others = myConnections.filter(
    (c) => c.status === "active" && c.id !== current?.connectionId,
  );
  const mine = current?.isMine
    ? myConnections.find((c) => c.id === current.connectionId)
    : undefined;
  return (
    <Card
      as="section"
      id="sending"
      className="flex scroll-mt-20 flex-col gap-3"
    >
      <GmailConnectResult />
      <div className="flex items-center gap-3">
        <Sticker tone={current?.status === "broken" ? "warning" : "primary"}>
          {current?.status === "broken" ? (
            <Warning weight="bold" />
          ) : (
            <EnvelopeSimple weight="bold" />
          )}
        </Sticker>
        <h2 className="font-display text-xl">{t("title")}</h2>
      </div>
      {current ? (
        <div className="flex flex-col gap-1">
          <p className="font-bold break-words">
            {t("from", { workspace: workspace.name, email: current.email })}
          </p>
          <p className="text-sm text-muted-ink">
            {t("connectedBy", {
              name: current.connectedBy,
              date: format(new Date(current.connectedAt), "d MMM yyyy"),
            })}
          </p>
          <p className="text-sm">
            <span
              className={cn(
                "rounded-full border-2 border-outline px-2 text-xs font-bold text-on-fill",
                current.status === "active"
                  ? "bg-fill-success"
                  : "bg-fill-danger",
              )}
            >
              {current.status === "active" ? t("active") : t("broken")}
            </span>{" "}
            {t("usage", {
              sent: current.sentLast24h,
              limit: current.dailyLimit,
            })}
          </p>
          {current.status === "broken" ? (
            <p className="text-sm">{t("brokenHelp")}</p>
          ) : null}
        </div>
      ) : (
        <p>{t("none")}</p>
      )}
      {isOwner ? (
        <div className="flex flex-col gap-2">
          {!current || current.status === "broken" ? (
            <Button asChild tone="primary">
              <a href={connectHref}>
                {current ? t("reconnect") : t("connect")}
              </a>
            </Button>
          ) : (
            <Button onClick={() => setPending({ kind: "replace" })}>
              {t("replace")}
            </Button>
          )}
          {others.map((connection) => (
            <Button
              key={connection.id}
              onClick={() =>
                setPending({
                  kind: "use",
                  id: connection.id,
                  email: connection.email,
                })
              }
            >
              {t("use", { email: connection.email })}
            </Button>
          ))}
          <p className="text-sm text-muted-ink">{t("tipGroup")}</p>
          <p className="text-sm text-muted-ink">
            {t("tipAdmins", { workspace: workspace.name })}
          </p>
          <details className="group rounded-control border-[length:var(--tn-border-width)] border-outline p-3 text-sm">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-bold [&::-webkit-details-marker]:hidden">
              <CaretRight
                weight="bold"
                aria-hidden
                className="shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
              />
              {t("unverifiedTitle")}
            </summary>
            <p className="mt-2">{t("unverifiedBody")}</p>
          </details>
        </div>
      ) : (
        <p className="text-sm text-muted-ink">
          {t("askOwner", { owner: ownerName })}
        </p>
      )}
      {mine ? (
        <Button
          tone="danger"
          onClick={() =>
            setPending({
              kind: "disconnect",
              id: mine.id,
              email: mine.email,
              usedBy: mine.usedBy,
            })
          }
        >
          {t("disconnect", { email: mine.email })}
        </Button>
      ) : null}
      <ConfirmDialog
        open={pending?.kind === "use"}
        onOpenChange={(open) => !open && setPending(null)}
        title={
          pending?.kind === "use"
            ? t("useTitle", { workspace: workspace.name, email: pending.email })
            : ""
        }
        description={t("useBody")}
        confirmLabel={
          pending?.kind === "use" ? t("use", { email: pending.email }) : ""
        }
        pending={setSender.isPending}
        onConfirm={() =>
          pending?.kind === "use" &&
          setSender.mutate(pending.id, { onSuccess: () => setPending(null) })
        }
      />
      <ConfirmDialog
        open={pending?.kind === "replace"}
        onOpenChange={(open) => !open && setPending(null)}
        title={t("replaceTitle", { workspace: workspace.name })}
        description={t("replaceBody")}
        confirmLabel={t("replaceAction")}
        onConfirm={() => {
          window.location.href = connectHref;
        }}
      />
      <ConfirmDialog
        open={pending?.kind === "disconnect"}
        onOpenChange={(open) => !open && setPending(null)}
        title={
          pending?.kind === "disconnect"
            ? t("disconnectTitle", { email: pending.email })
            : ""
        }
        description={
          pending?.kind === "disconnect"
            ? t("disconnectBody", { workspaces: pending.usedBy.join(", ") })
            : ""
        }
        confirmLabel={t("disconnectAction")}
        tone="danger"
        pending={disconnect.isPending}
        onConfirm={() =>
          pending?.kind === "disconnect" &&
          disconnect.mutate(pending.id, {
            onSuccess: () => {
              setPending(null);
              toast(t("disconnected"));
            },
          })
        }
      />
    </Card>
  );
}
