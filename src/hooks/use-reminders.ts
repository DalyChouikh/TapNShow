"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { errorCodeOf } from "@/lib/api-client";
import {
  type RemindersState,
  remindersState,
  turnOffReminders,
  turnOnReminders,
} from "@/lib/push/client";

/**
 * This device's reminders (spec §7.4): its state (null while it is read), Turn on and Turn off.
 * A failed Turn on keeps the state and says why.
 */
export function useReminders() {
  const tErrors = useTranslations("ApiErrors");
  const [state, setState] = useState<RemindersState | null>(null);
  useEffect(() => {
    let live = true;
    remindersState()
      .catch((): RemindersState => "unsupported")
      .then((value) => {
        if (live) {
          setState(value);
        }
      });
    return () => {
      live = false;
    };
  }, []);
  const on = useMutation({
    mutationFn: turnOnReminders,
    onSuccess: setState,
    onError: (error) => toast.error(tErrors(errorCodeOf(error))),
  });
  const off = useMutation({
    mutationFn: turnOffReminders,
    onSuccess: () => setState("off"),
  });
  return {
    state,
    turnOn: () => on.mutate(),
    turnOff: () => off.mutate(),
    pending: on.isPending || off.isPending,
    /** Turned on in this visit (the card says so once). */
    justTurnedOn: on.data === "on",
  };
}
