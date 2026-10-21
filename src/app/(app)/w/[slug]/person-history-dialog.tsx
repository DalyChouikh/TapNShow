"use client";

import { ContactHistory } from "@/components/members/contact-history";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PeriodChoice } from "@/lib/responses/periods";

/** The person Home opens the history of. */
export type HistoryPerson = { contactId: string; fullName: string };

/**
 * A member's history over Home (design §2.5): the same history Lists shows in the person sheet,
 * opening on Home's period. Closed while `person` is null.
 */
export function PersonHistoryDialog({
  slug,
  timezone,
  period,
  person,
  onClose,
}: {
  slug: string;
  timezone: string;
  period: PeriodChoice;
  person: HistoryPerson | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={person !== null} onOpenChange={(open) => !open && onClose()}>
      {person ? (
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{person.fullName}</DialogTitle>
          </DialogHeader>
          <ContactHistory
            slug={slug}
            contactId={person.contactId}
            timezone={timezone}
            initialPeriod={period}
          />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
