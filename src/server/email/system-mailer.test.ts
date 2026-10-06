import { describe, expect, it, vi } from "vitest";
import { createSystemMailer } from "./system-mailer";

describe("SystemMailer", () => {
  it("sends from the platform sender named after the app", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "m1" }));
    await createSystemMailer({ sendMail }).send({
      to: "a@example.test",
      subject: "S",
      html: "<p>H</p>",
      text: "H",
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: { name: "TapNShow", address: "no-reply@example.test" },
      to: "a@example.test",
      subject: "S",
      html: "<p>H</p>",
      text: "H",
    });
  });
});
