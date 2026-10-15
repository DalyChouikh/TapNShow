/** What happened, as the embed's colour (spec §5: green ok, red failed, amber needs a look, purple info). */
export type DiscordTone = "success" | "failure" | "attention" | "info";

/** Embed colours (Discord takes an integer). */
export const DISCORD_COLORS: Record<DiscordTone, number> = {
  success: 0x23a55a,
  failure: 0xf23f43,
  attention: 0xf0b232,
  info: 0xc4b5fd,
};

/**
 * Discord's embed limits (docs.discord.com/developers/resources/message, checked 2026-10-15):
 * over any of them Discord refuses the whole message.
 */
export const DISCORD_LIMITS = {
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  total: 6000,
} as const;

/** One event to post: counts, ids and workspace names only, never a person's name or email. */
export type DiscordEvent = {
  tone: DiscordTone;
  title: string;
  url?: string;
  description?: string;
  fields?: ReadonlyArray<{ name: string; value: string }>;
  source: string;
  at: Date;
};

type Field = { name: string; value: string; inline: true };

/** A webhook message with one embed. */
export type DiscordMessage = {
  allowed_mentions: { parse: [] };
  embeds: [
    {
      color: number;
      title: string;
      url?: string;
      description?: string;
      fields?: Field[];
      footer: { text: string };
      timestamp: string;
    },
  ];
};

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/**
 * The one embed for an event (spec §5): every part trimmed to Discord's limits, fields inline,
 * empty parts left out, and mentions always off.
 */
export function discordMessage(event: DiscordEvent): DiscordMessage {
  const title = clip(event.title, DISCORD_LIMITS.title);
  const footer = clip(event.source, 200);
  let budget = DISCORD_LIMITS.total - title.length - footer.length;
  const fields: Field[] = [];
  for (const field of (event.fields ?? []).slice(0, DISCORD_LIMITS.fields)) {
    const name = clip(field.name, DISCORD_LIMITS.fieldName);
    const value = clip(field.value, DISCORD_LIMITS.fieldValue);
    if (!name || !value || name.length + value.length > budget) {
      continue;
    }
    budget -= name.length + value.length;
    fields.push({ name, value, inline: true });
  }
  const description = clip(
    event.description ?? "",
    Math.min(DISCORD_LIMITS.description, budget),
  );
  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        color: DISCORD_COLORS[event.tone],
        title,
        ...(event.url ? { url: event.url } : {}),
        ...(description ? { description } : {}),
        ...(fields.length ? { fields } : {}),
        footer: { text: footer },
        timestamp: event.at.toISOString(),
      },
    ],
  };
}
