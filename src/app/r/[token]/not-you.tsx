"use client";

import { useTranslations } from "next-intl";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/** "Answering as <name>. Not you?": explains that the link is personal (spec §6 Identity rules). */
export function NotYou({
  fullName,
  workspaceName,
}: {
  fullName: string;
  workspaceName: string;
}) {
  const t = useTranslations("AnswerPage");
  return (
    <p className="text-sm">
      {t("answeringAs", { name: fullName })}{" "}
      <Popover>
        <PopoverTrigger className="inline-flex min-h-11 items-center font-bold underline">
          {t("notYou")}
        </PopoverTrigger>
        <PopoverContent className="flex max-w-xs flex-col gap-2 p-3">
          <p className="font-bold">{t("notYouTitle")}</p>
          <p className="text-sm">
            {t("notYouBody", { name: fullName, workspace: workspaceName })}
          </p>
        </PopoverContent>
      </Popover>
    </p>
  );
}
