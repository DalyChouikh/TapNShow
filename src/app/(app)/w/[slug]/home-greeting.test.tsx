import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { HomeGreeting } from "./home-greeting";

/** A fixed hour of the browser's own clock. */
const at = (hour: number) => new Date(2026, 9, 17, hour, 30);
const roster = { members: 30, lists: 2 };

describe("HomeGreeting", () => {
  it.each([
    [4, "Good evening, Amira"],
    [5, "Good morning, Amira"],
    [11, "Good morning, Amira"],
    [12, "Good afternoon, Amira"],
    [17, "Good afternoon, Amira"],
    [18, "Good evening, Amira"],
  ])("greets by the time of day (%s:30)", (hour, greeting) => {
    renderWithProviders(
      <HomeGreeting
        workspaceName="Robotics Club"
        name="Amira"
        roster={roster}
        welcome={false}
        now={at(hour)}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: greeting }),
    ).toBeInTheDocument();
  });

  it("says the workspace, its members and, on computers, its lists", () => {
    renderWithProviders(
      <HomeGreeting
        workspaceName="Robotics Club"
        name={null}
        roster={{ members: 1, lists: 2 }}
        welcome={false}
        now={at(9)}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Good morning" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Robotics Club · 1 member/)).toBeInTheDocument();
    expect(screen.getByText("· 2 lists")).toHaveClass("hidden", "lg:inline");
  });

  it("welcomes a new workspace with what's left to do", () => {
    renderWithProviders(
      <HomeGreeting
        workspaceName="Riverside Volunteers"
        name="Amira"
        roster={roster}
        welcome
        now={at(9)}
      />,
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Welcome to Riverside Volunteers",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Two steps and you can send your first invite."),
    ).toBeInTheDocument();
  });

  it("greets before the counts arrive", () => {
    renderWithProviders(
      <HomeGreeting
        workspaceName="Robotics Club"
        name="Amira"
        roster={undefined}
        welcome={false}
        now={at(20)}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Good evening, Amira" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Robotics Club")).toBeInTheDocument();
  });
});
