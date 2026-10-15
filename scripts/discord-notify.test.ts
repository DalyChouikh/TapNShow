import { describe, expect, it } from "vitest";
import { parseNotifyArgs } from "./discord-notify";

describe("parseNotifyArgs", () => {
  it("reads the event and the webhook's env name", () => {
    expect(
      parseNotifyArgs([
        "--webhook-env",
        "DISCORD_DEPLOYS_WEBHOOK",
        "--tone",
        "failure",
        "--title",
        "CI failed on main",
        "--url",
        "https://github.com/x/y/actions/runs/1",
        "--field",
        "Commit=`c4c7ca7`",
        "--field",
        "Failed job=db",
        "--source",
        "main",
      ]),
    ).toEqual({
      webhookEnv: "DISCORD_DEPLOYS_WEBHOOK",
      event: {
        tone: "failure",
        title: "CI failed on main",
        url: "https://github.com/x/y/actions/runs/1",
        fields: [
          { name: "Commit", value: "`c4c7ca7`" },
          { name: "Failed job", value: "db" },
        ],
        source: "main",
      },
    });
  });

  it("refuses an unknown tone or a missing title", () => {
    expect(() =>
      parseNotifyArgs([
        "--webhook-env",
        "X",
        "--tone",
        "loud",
        "--title",
        "t",
        "--source",
        "s",
      ]),
    ).toThrow(/tone/);
    expect(() =>
      parseNotifyArgs([
        "--webhook-env",
        "X",
        "--tone",
        "info",
        "--source",
        "s",
      ]),
    ).toThrow(/title/);
  });
});
