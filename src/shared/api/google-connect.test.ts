import { describe, expect, it } from "vitest";
import { googleConnectHref } from "./google-connect";

describe("googleConnectHref", () => {
  it("names the purpose, and asks for a new sheet only when told", () => {
    expect(googleConnectHref("club-ab12", "sheets", { replace: true })).toBe(
      "/api/integrations/google/connect?workspace=club-ab12&purpose=sheets&replace=1",
    );
    expect(googleConnectHref("club-ab12", "sending")).toBe(
      "/api/integrations/google/connect?workspace=club-ab12&purpose=sending",
    );
  });

  it("carries where to come back to", () => {
    expect(
      googleConnectHref("club-ab12", "sending", {
        next: "/w/club-ab12/meetings/1/edit",
      }),
    ).toBe(
      "/api/integrations/google/connect?workspace=club-ab12&purpose=sending&next=%2Fw%2Fclub-ab12%2Fmeetings%2F1%2Fedit",
    );
  });
});
