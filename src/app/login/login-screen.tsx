"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { EnvelopeSimple, Password } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { GoogleButton } from "@/components/auth/google-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sticker } from "@/components/ui/sticker";
import { APP_NAME } from "@/config/app";
import { OTP_LENGTH, OTP_RESEND_SECONDS } from "@/config/auth";
import { publicEnv } from "@/config/public-env";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { safeNextPath } from "@/lib/safe-next-path";
import { otpSendBodySchema, otpVerifyBodySchema } from "@/shared/api/auth";
import { okSchema } from "@/shared/api/common";

type EmailForm = z.input<typeof otpSendBodySchema>;
type CodeForm = { code: string };

/** Email → code sign-in. The Google button is added in Task 7. */
export function LoginScreen() {
  const t = useTranslations("Auth");
  const tErrors = useTranslations("ApiErrors");
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const errorParam = searchParams.get("error");
  const googleHref = `/api/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  const [email, setEmail] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (secondsLeft <= 0) {
      return;
    }
    const timer = window.setTimeout(
      () => setSecondsLeft((value) => value - 1),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  const emailForm = useForm<EmailForm>({
    resolver: zodResolver(otpSendBodySchema),
  });
  const codeForm = useForm<CodeForm>({
    resolver: zodResolver(otpVerifyBodySchema.pick({ code: true })),
  });

  const sendCode = useMutation({
    mutationFn: (target: string) =>
      apiRequest("/api/auth/otp/send", {
        method: "POST",
        body: { email: target },
        schema: okSchema,
      }),
    onSuccess: (_result, target) => {
      setEmail(target);
      setSecondsLeft(OTP_RESEND_SECONDS);
    },
  });
  const verify = useMutation({
    mutationFn: (code: string) =>
      apiRequest("/api/auth/otp/verify", {
        method: "POST",
        body: { email, code },
        schema: okSchema,
      }),
    onSuccess: () =>
      router.replace(
        next ? `/welcome?next=${encodeURIComponent(next)}` : "/welcome",
      ),
  });

  const errorText = (error: Error | null): string | undefined =>
    error
      ? tErrors(error instanceof ApiClientError ? error.code : "internal")
      : undefined;

  if (!email) {
    return (
      <div className="flex flex-col gap-4">
        {errorParam === "google_failed" ||
        errorParam === "google_unavailable" ? (
          <p
            role="alert"
            className="rounded-control border-2 border-outline bg-fill-warning p-3 font-bold text-on-fill"
          >
            {errorParam === "google_failed"
              ? t("googleFailed")
              : tErrors("google_unavailable")}
          </p>
        ) : null}
        <Card key="email-step" as="section" className="flex flex-col gap-4">
          <Sticker tone="primary">
            <EnvelopeSimple weight="bold" />
          </Sticker>
          <h1 className="font-display text-3xl">
            {t("title", { appName: APP_NAME })}
          </h1>
          <p className="text-muted-ink">{t("subtitle")}</p>
          <form
            className="flex flex-col gap-4"
            onSubmit={emailForm.handleSubmit((values) =>
              sendCode.mutate(values.email),
            )}
            noValidate
          >
            <Input
              id="email"
              type="email"
              autoComplete="email"
              label={t("emailLabel")}
              placeholder={t("emailPlaceholder")}
              error={
                emailForm.formState.errors.email
                  ? t("invalidEmail")
                  : errorText(sendCode.error)
              }
              {...emailForm.register("email")}
            />
            <Button
              type="submit"
              tone="primary"
              size="lg"
              disabled={sendCode.isPending}
            >
              {t("sendCode")}
            </Button>
          </form>
          {publicEnv.NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED ? (
            <>
              <p className="text-center text-sm font-bold text-muted-ink">
                {t("or")}
              </p>
              <GoogleButton href={googleHref} />
            </>
          ) : null}
        </Card>
      </div>
    );
  }

  return (
    <Card key="code-step" as="section" className="flex flex-col gap-4">
      <Sticker tone="warning">
        <Password weight="bold" />
      </Sticker>
      <h1 className="font-display text-3xl">{t("codeTitle")}</h1>
      <p className="text-muted-ink">
        {t("codeSent", { length: OTP_LENGTH, email })}
      </p>
      <form
        className="flex flex-col gap-4"
        onSubmit={codeForm.handleSubmit((values) => verify.mutate(values.code))}
        noValidate
      >
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          label={t("codeLabel")}
          hint={t("codeHint")}
          error={
            codeForm.formState.errors.code
              ? t("invalidCodeFormat", { length: OTP_LENGTH })
              : errorText(verify.error)
          }
          {...codeForm.register("code")}
        />
        <Button
          type="submit"
          tone="primary"
          size="lg"
          disabled={verify.isPending}
        >
          {t("verify")}
        </Button>
      </form>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={secondsLeft > 0 || sendCode.isPending}
          onClick={() => sendCode.mutate(email)}
        >
          {secondsLeft > 0
            ? t("resendIn", { seconds: secondsLeft })
            : t("resend")}
        </Button>
        <Button
          onClick={() => {
            setEmail(null);
            verify.reset();
            codeForm.reset();
          }}
        >
          {t("differentEmail")}
        </Button>
      </div>
    </Card>
  );
}
