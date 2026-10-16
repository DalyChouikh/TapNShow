"use client";

import { UserPlus } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { useInviteAdmin } from "@/hooks/use-admin";
import { errorCodeOf } from "@/lib/api-client";
import { copyText } from "@/lib/clipboard";
import { maskEmail } from "@/lib/mask-email";
import {
  adminInviteBodySchema,
  type AdminInviteResult,
} from "@/shared/api/admin";

type Delivery = "email" | "link";

/** The invite's address as the API will store it (trimmed, lower case), or null if invalid. */
function validEmail(value: string): string | null {
  const parsed = adminInviteBodySchema.shape.email.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function ResultView({
  result,
  email,
}: {
  result: AdminInviteResult;
  email: string;
}) {
  const t = useTranslations("Admin.admins");
  const tCommon = useTranslations("Common");
  if (result.status === "sent") {
    return <p>{t("sent", { email: maskEmail(email) })}</p>;
  }
  if (result.status === "link" && result.link) {
    const link = result.link;
    return (
      <div className="flex flex-col gap-3">
        <p>{t("linkReady")}</p>
        <Input
          id="admin-invite-link"
          label={t("linkLabel")}
          value={link}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          tone="primary"
          className="self-start"
          onClick={() =>
            void copyText(link).then((copied) =>
              copied
                ? toast(t("linkCopied"))
                : toast.error(tCommon("copyLinkFailed")),
            )
          }
        >
          {t("copyLink")}
        </Button>
      </div>
    );
  }
  return (
    <p className="font-bold">
      {result.status === "email_limit" ? t("emailLimit") : t("emailFailed")}
    </p>
  );
}

/**
 * Add an admin (platform owner only, spec §7.19): one address, emailed (within the platform's
 * daily budget) or as a link to copy; the invite works only for that address, for 7 days.
 */
export function InviteAdminButton() {
  const t = useTranslations("Admin.admins");
  const tErrors = useTranslations("ApiErrors");
  const invite = useInviteAdmin();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [delivery, setDelivery] = useState<Delivery>("email");
  const valid = validEmail(email);

  const close = (next: boolean) => {
    if (!next) {
      setEmail("");
      setDelivery("email");
      invite.reset();
    }
    setOpen(next);
  };

  return (
    <>
      <Button
        tone="primary"
        className="self-start"
        onClick={() => setOpen(true)}
      >
        <UserPlus weight="bold" aria-hidden />
        {t("add")}
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("add")}</DialogTitle>
            <DialogDescription>{t("addHelp")}</DialogDescription>
          </DialogHeader>
          {invite.data && valid ? (
            <>
              <ResultView result={invite.data} email={valid} />
              <DialogFooter>
                <Button onClick={() => close(false)}>{t("done")}</Button>
              </DialogFooter>
            </>
          ) : (
            <form
              className="flex flex-col gap-4"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                if (valid) {
                  invite.mutate({ email: valid, delivery });
                }
              }}
            >
              <Input
                id="admin-invite-email"
                type="email"
                autoComplete="off"
                label={t("email")}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <div className="flex flex-col gap-2">
                <span id="admin-invite-delivery" className="text-sm font-bold">
                  {t("delivery")}
                </span>
                <RadioGroup
                  aria-labelledby="admin-invite-delivery"
                  value={delivery}
                  onValueChange={(value) =>
                    setDelivery(value === "link" ? "link" : "email")
                  }
                >
                  <RadioCard value="email">{t("byEmail")}</RadioCard>
                  <RadioCard value="link">{t("byLink")}</RadioCard>
                </RadioGroup>
              </div>
              {invite.error ? (
                <p role="alert" className="text-sm font-bold">
                  {tErrors(errorCodeOf(invite.error))}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  type="submit"
                  tone="primary"
                  disabled={!valid || invite.isPending}
                >
                  {delivery === "email" ? t("send") : t("makeLink")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
