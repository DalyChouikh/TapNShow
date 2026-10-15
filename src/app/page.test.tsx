import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import messages from "../../messages/en.json";
import HomePage from "./page";

vi.mock("@/components/public/public-shell", () => ({
  PublicShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("HomePage", () => {
  it("has one h1 and the six sections: hero, how, features, privacy, FAQ, final call", () => {
    renderWithProviders(<HomePage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const name of [
      "Know who's coming before the meeting starts.",
      "How it works",
      "Everything a group needs",
      "We send email. We never read it.",
      "Questions",
      "Run your next meeting with TapNShow",
    ]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
  });

  it("never names GDG ISSAT as an example", () => {
    expect(JSON.stringify(messages.Landing)).not.toMatch(/gdg|issat/i);
  });
});
