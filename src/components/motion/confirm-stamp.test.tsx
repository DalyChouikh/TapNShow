import { screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import messages from "../../../messages/en.json";
import { DEFAULT_LOCALE } from "@/config/i18n";
import { MotionProvider } from "./motion-provider";
import { describe, expect, it } from "vitest";
import { setReducedMotion } from "@/test/match-media";
import { renderWithProviders } from "@/test/render";
import { ConfirmStamp } from "./confirm-stamp";

describe("ConfirmStamp", () => {
  it("renders the stamp with confetti when motion is allowed", () => {
    renderWithProviders(<ConfirmStamp label="Confirmed" show />);
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getAllByTestId("confetti-piece")).toHaveLength(6);
  });

  it("renders the stamp instantly without confetti for reduced-motion users", () => {
    setReducedMotion(true);
    renderWithProviders(<ConfirmStamp label="Confirmed" show />);
    expect(screen.getByText("Confirmed")).toBeVisible();
    expect(screen.queryAllByTestId("confetti-piece")).toHaveLength(0);
  });

  it("skips the confetti when asked (Late and Absent answers)", () => {
    renderWithProviders(
      <ConfirmStamp label="Confirmed" show confetti={false} />,
    );
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.queryAllByTestId("confetti-piece")).toHaveLength(0);
  });

  it("renders nothing when hidden", () => {
    renderWithProviders(<ConfirmStamp label="Confirmed" show={false} />);
    expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
  });

  it("announces the confirmation to assistive technology", () => {
    renderWithProviders(<ConfirmStamp label="Confirmed" show />);
    expect(screen.getByRole("status")).toHaveTextContent("Confirmed");
  });

  it("server-renders the final state: no confetti and a fully visible stamp", () => {
    const html = renderToString(
      <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
        <MotionProvider>
          <ConfirmStamp label="Confirmed" show />
        </MotionProvider>
      </NextIntlClientProvider>,
    );
    expect(html).toContain("Confirmed");
    expect(html).not.toContain("confetti-piece");
    expect(html).not.toMatch(/opacity:\s*0[;"]/);
    expect(html).not.toContain("scale(2.4)");
  });
});
