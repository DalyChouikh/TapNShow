import {
  CalendarDots,
  GearSix,
  UsersThree,
  WarningOctagon,
  type Icon,
} from "@phosphor-icons/react";
import { Sticker, type StickerTone } from "@/components/ui/sticker";

const ICONS: Record<
  "general" | "defaults" | "people" | "danger",
  { glyph: Icon; tone: StickerTone }
> = {
  general: { glyph: GearSix, tone: "primary" },
  defaults: { glyph: CalendarDots, tone: "primary" },
  people: { glyph: UsersThree, tone: "primary" },
  danger: { glyph: WarningOctagon, tone: "danger" },
};

/**
 * The fixed icon of a Settings section (spec §10, colour means state): calm sections share the
 * purple tile and the Danger zone is red; Sending and Google Sheets pick their tones from their
 * state themselves, so a yellow or green tile always means something.
 */
export function SectionIcon({ section }: { section: keyof typeof ICONS }) {
  const { glyph: Glyph, tone } = ICONS[section];
  return (
    <Sticker tone={tone}>
      <Glyph weight="bold" />
    </Sticker>
  );
}
