"use client";

import { getHours } from "date-fns";
import { useTranslations } from "next-intl";
import { GREETING_HOURS } from "@/config/home";
import type { WorkspaceInsights } from "@/shared/api/insights";

/** The part of the day on the browser's clock. */
function partOfDay(now: Date): "morning" | "afternoon" | "evening" {
  const hour = getHours(now);
  if (hour >= GREETING_HOURS.evening || hour < GREETING_HOURS.morning) {
    return "evening";
  }
  return hour >= GREETING_HOURS.afternoon ? "afternoon" : "morning";
}

/**
 * Home's heading (design §2.1): "Good evening, Amira" and the workspace with its members (and lists
 * on a computer), or "Welcome to <workspace>" with what's left while setup isn't done.
 */
export function HomeGreeting({
  workspaceName,
  name,
  roster,
  welcome,
  now,
}: {
  workspaceName: string;
  /** The signed-in person's first name, when they set one. */
  name: string | null;
  roster: Pick<WorkspaceInsights["roster"], "members" | "lists"> | undefined;
  welcome: boolean;
  now: Date;
}) {
  const t = useTranslations("WorkspaceHome");
  const part = partOfDay(now);
  return (
    <header className="flex flex-col gap-1">
      <h1 className="font-display text-3xl break-words">
        {welcome
          ? t("title", { workspace: workspaceName })
          : name
            ? t("greetingNamed", { part, name })
            : t("greeting", { part })}
      </h1>
      <p className="break-words text-muted-ink">
        {welcome ? (
          t("setupLead")
        ) : (
          <>
            {workspaceName}
            {roster ? (
              <>
                {` · ${t("members", { count: roster.members })}`}
                <span className="hidden lg:inline">
                  {` · ${t("lists", { count: roster.lists })}`}
                </span>
              </>
            ) : null}
          </>
        )}
      </p>
    </header>
  );
}
