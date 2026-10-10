"use client";

import { useState } from "react";
import {
  type EditFields,
  editFieldsSchema,
  type Meeting,
  type UpdateMeetingBody,
} from "@/shared/api/meetings";

const storageKey = (id: string) => `tn:edit:${id}`;
/** Fields holding an instant: compare the time, not how it is written. */
const INSTANT_FIELDS = new Set(["startsAt", "responseDeadline"]);
/** Fixed once sent (spec §4); a Responses patch still carries them. */
const LOCKED_FIELDS = new Set(["responseMode", "delayOptions"]);

type FieldValue = string | number | boolean | null | number[] | undefined;

function differs(key: string, value: FieldValue, saved: FieldValue): boolean {
  if (
    INSTANT_FIELDS.has(key) &&
    typeof value === "string" &&
    typeof saved === "string"
  ) {
    return new Date(value).getTime() !== new Date(saved).getTime();
  }
  return JSON.stringify(value) !== JSON.stringify(saved);
}

function read(id: string): EditFields | null {
  try {
    const raw = sessionStorage.getItem(storageKey(id));
    const parsed = raw ? editFieldsSchema.safeParse(JSON.parse(raw)) : null;
    return parsed?.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function write(id: string, fields: EditFields | null): void {
  try {
    if (fields) {
      sessionStorage.setItem(storageKey(id), JSON.stringify(fields));
    } else {
      sessionStorage.removeItem(storageKey(id));
    }
  } catch {
    // Private mode or blocked storage: the draft lives in memory for this visit only.
  }
}

/** Unsaved edits of a sent meeting, kept per tab until Review changes saves them (spec §7.5). */
export type EditDraft = {
  /** Only what differs from the saved meeting; null while nothing does. */
  fields: EditFields | null;
  /** The saved meeting with the edits applied. */
  view: Meeting;
  save: (patch: UpdateMeetingBody) => void;
  clear: () => void;
};

/** The edit draft of `meeting`. */
export function useEditDraft(meeting: Meeting): EditDraft {
  const [fields, setFields] = useState<EditFields | null>(() =>
    read(meeting.id),
  );
  const savedValues = new Map<string, FieldValue>(Object.entries(meeting));
  const save = (patch: UpdateMeetingBody) => {
    const merged = new Map<string, FieldValue>(Object.entries(fields ?? {}));
    for (const [key, value] of Object.entries(patch)) {
      if (!LOCKED_FIELDS.has(key)) {
        merged.set(key, value);
      }
    }
    const kept = Object.fromEntries(
      [...merged].filter(([key, value]) =>
        differs(key, value, savedValues.get(key)),
      ),
    );
    const next =
      Object.keys(kept).length > 0 ? editFieldsSchema.parse(kept) : null;
    write(meeting.id, next);
    setFields(next);
  };
  const clear = () => {
    write(meeting.id, null);
    setFields(null);
  };
  return { fields, view: { ...meeting, ...fields }, save, clear };
}
