import { describe, expect, it } from "vitest";
import { DISCORD_COLORS, DISCORD_LIMITS, discordMessage } from "./embed";

const at = new Date("2026-10-15T14:13:00Z");

describe("discordMessage", () => {
  it("builds one embed with the tone's colour, a linked title, inline fields and a footer", () => {
    expect(
      discordMessage({
        tone: "success",
        title: "Production deploy succeeded",
        url: "https://tapnshow.vercel.app",
        description: "docs(spec): M8 done (#324)",
        fields: [{ name: "Commit", value: "`a618827`" }],
        source: "deploys",
        at,
      }),
    ).toEqual({
      allowed_mentions: { parse: [] },
      embeds: [
        {
          color: DISCORD_COLORS.success,
          title: "Production deploy succeeded",
          url: "https://tapnshow.vercel.app",
          description: "docs(spec): M8 done (#324)",
          fields: [{ name: "Commit", value: "`a618827`", inline: true }],
          footer: { text: "deploys" },
          timestamp: "2026-10-15T14:13:00.000Z",
        },
      ],
    });
  });

  it("trims every part to Discord's limits (Discord refuses a message over any of them)", () => {
    const long = "x".repeat(10_000);
    const message = discordMessage({
      tone: "failure",
      title: long,
      description: long,
      fields: Array.from({ length: 40 }, (_, index) => ({
        name: `${index}${long}`,
        value: long,
      })),
      source: long,
      at,
    });
    const [embed] = message.embeds;
    expect(embed.title.length).toBeLessThanOrEqual(DISCORD_LIMITS.title);
    expect(embed.description?.length ?? 0).toBeLessThanOrEqual(
      DISCORD_LIMITS.description,
    );
    expect(embed.fields?.length ?? 0).toBeLessThanOrEqual(
      DISCORD_LIMITS.fields,
    );
    for (const field of embed.fields ?? []) {
      expect(field.name.length).toBeLessThanOrEqual(DISCORD_LIMITS.fieldName);
      expect(field.value.length).toBeLessThanOrEqual(DISCORD_LIMITS.fieldValue);
    }
    const total =
      embed.title.length +
      (embed.description?.length ?? 0) +
      embed.footer.text.length +
      (embed.fields ?? []).reduce(
        (sum, field) => sum + field.name.length + field.value.length,
        0,
      );
    expect(total).toBeLessThanOrEqual(DISCORD_LIMITS.total);
    expect(embed.title.endsWith("…")).toBe(true);
  });

  it("never lets text mention anyone", () => {
    const message = discordMessage({
      tone: "info",
      title: "@everyone hi",
      source: "x",
      at,
    });
    expect(message.allowed_mentions).toEqual({ parse: [] });
  });

  it("drops empty fields and keeps an empty description out", () => {
    const [embed] = discordMessage({
      tone: "attention",
      title: "t",
      description: " ",
      fields: [{ name: "Run", value: "" }],
      source: "s",
      at,
    }).embeds;
    expect(embed.description).toBeUndefined();
    expect(embed.fields).toBeUndefined();
  });
});
