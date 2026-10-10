import type { FillTone } from "@/design/tokens";
import type { Mark } from "@/shared/api/responses";

/** The fill of each check-in, like the tiles: the door's chips and the Excel cells. */
export const ACTUAL_TONE: Record<Mark["actual"], FillTone> = {
  present: "success",
  late: "warning",
  absent: "danger",
};

/** The fill of each answer, and of no reply, like the tiles (Excel cells). */
export const ANSWER_TONE: Record<
  "attending" | "late" | "absent" | "not_attending" | "no_reply",
  FillTone
> = {
  attending: "success",
  late: "warning",
  absent: "danger",
  not_attending: "danger",
  no_reply: "neutral",
};
