import { describe, expect, it } from "vitest";
import { trustedAppOrigin } from "./app-origin";

const trusted = {
  appUrl: "https://tapnshow.vercel.app",
  vercelUrl: "tapnshow-abc123-dalychouikhs-projects.vercel.app",
  vercelBranchUrl: "tapnshow-git-feat-x-dalychouikhs-projects.vercel.app",
};

describe("trustedAppOrigin", () => {
  it("keeps the request origin when it is this deployment", () => {
    expect(trustedAppOrigin("https://tapnshow.vercel.app", trusted)).toBe(
      "https://tapnshow.vercel.app",
    );
    expect(
      trustedAppOrigin(
        "https://tapnshow-abc123-dalychouikhs-projects.vercel.app",
        trusted,
      ),
    ).toBe("https://tapnshow-abc123-dalychouikhs-projects.vercel.app");
    expect(
      trustedAppOrigin(
        "https://tapnshow-git-feat-x-dalychouikhs-projects.vercel.app",
        trusted,
      ),
    ).toBe("https://tapnshow-git-feat-x-dalychouikhs-projects.vercel.app");
  });

  it("never lets a spoofed host or Origin choose where emailed links point", () => {
    expect(trustedAppOrigin("https://evil.example", trusted)).toBe(
      "https://tapnshow.vercel.app",
    );
    expect(trustedAppOrigin("http://tapnshow.vercel.app", trusted)).toBe(
      "https://tapnshow.vercel.app",
    );
    expect(
      trustedAppOrigin("https://tapnshow.vercel.app.evil.example", trusted),
    ).toBe("https://tapnshow.vercel.app");
  });

  it("works locally without Vercel variables", () => {
    expect(
      trustedAppOrigin("http://localhost:3000", {
        appUrl: "http://localhost:3000",
      }),
    ).toBe("http://localhost:3000");
    expect(
      trustedAppOrigin("http://127.0.0.1:3000", {
        appUrl: "http://localhost:3000",
      }),
    ).toBe("http://localhost:3000");
  });
});
