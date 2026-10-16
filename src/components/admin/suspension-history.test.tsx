import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { SuspensionHistory } from "./suspension-history";

describe("SuspensionHistory", () => {
  it("lists suspensions newest first with who started and lifted them", () => {
    renderWithProviders(
      <SuspensionHistory
        suspensions={[
          {
            id: "1b1f6a3e-5d0a-4a0e-9a49-3e2d0f5b9c11",
            reason: "auto_reports",
            createdAt: "2026-10-15T12:00:00+00:00",
            createdByName: null,
            liftedAt: null,
            liftedByName: null,
          },
          {
            id: "2b1f6a3e-5d0a-4a0e-9a49-3e2d0f5b9c11",
            reason: "platform_admin",
            createdAt: "2026-10-03T12:00:00+00:00",
            createdByName: "Sami",
            liftedAt: "2026-10-04T12:00:00+00:00",
            liftedByName: "Lina",
          },
          {
            id: "3b1f6a3e-5d0a-4a0e-9a49-3e2d0f5b9c11",
            reason: "platform_admin",
            createdAt: "2026-09-20T12:00:00+00:00",
            createdByName: null,
            liftedAt: "2026-09-21T12:00:00+00:00",
            liftedByName: null,
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Suspension history" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual([
      "15 Oct · automaticactive",
      "3 Oct · by Samilifted 4 Oct by Lina",
      "20 Sep · by an adminlifted 21 Sep",
    ]);
  });

  it("says when the workspace was never suspended", () => {
    renderWithProviders(<SuspensionHistory suspensions={[]} />);
    expect(screen.getByText("Never suspended.")).toBeInTheDocument();
  });
});
