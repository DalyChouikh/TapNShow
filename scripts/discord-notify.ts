import { parseArgs } from "node:util";
import {
  discordMessage,
  type DiscordEvent,
  type DiscordTone,
} from "../src/lib/discord/embed";
import { postToDiscord } from "../src/lib/discord/send";

const TONES: readonly DiscordTone[] = [
  "success",
  "failure",
  "attention",
  "info",
];

/** The CLI's arguments as an event (without its time) and the env var holding the webhook URL. */
export function parseNotifyArgs(argv: string[]): {
  webhookEnv: string;
  event: Omit<DiscordEvent, "at">;
} {
  const { values } = parseArgs({
    args: argv,
    options: {
      "webhook-env": { type: "string" },
      tone: { type: "string" },
      title: { type: "string" },
      url: { type: "string" },
      description: { type: "string" },
      field: { type: "string", multiple: true },
      source: { type: "string" },
    },
  });
  const tone = TONES.find((candidate) => candidate === values.tone);
  if (!tone) {
    throw new Error(`--tone must be one of ${TONES.join(", ")}`);
  }
  if (!values.title || !values.source || !values["webhook-env"]) {
    throw new Error("--title, --source and --webhook-env are required");
  }
  const fields = (values.field ?? []).map((field) => {
    const at = field.indexOf("=");
    return { name: field.slice(0, at), value: field.slice(at + 1) };
  });
  return {
    webhookEnv: values["webhook-env"],
    event: {
      tone,
      title: values.title,
      source: values.source,
      ...(values.url ? { url: values.url } : {}),
      ...(values.description ? { description: values.description } : {}),
      ...(fields.length ? { fields } : {}),
    },
  };
}

if (import.meta.main) {
  const { webhookEnv, event } = parseNotifyArgs(process.argv.slice(2));
  const webhook = process.env[webhookEnv];
  if (!webhook) {
    process.stdout.write(`${webhookEnv} is not set; nothing posted.\n`);
    process.exit(0);
  }
  const result = await postToDiscord(
    webhook,
    discordMessage({ ...event, at: new Date() }),
  );
  if (!result.ok) {
    process.stderr.write(`Discord refused the message (${result.status}).\n`);
    process.exit(1);
  }
}
