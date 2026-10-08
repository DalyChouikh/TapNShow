import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { workspaceFixture } from "@/test/fixtures/me";
import { meetingFixture } from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import { WizardShell } from "./wizard-shell";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

beforeEach(() => vi.clearAllMocks());

describe("WizardShell", () => {
  it("shows the step from the URL with its position", () => {
    renderWithProviders(
      <WizardShell
        slug="robotics-cd34"
        meeting={meetingFixture}
        workspace={workspaceFixture}
        stepParam="responses"
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Answers" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Step 3 of 4")).toBeInTheDocument();
  });

  it("offers only Audience and Review on a sent meeting", () => {
    renderWithProviders(
      <WizardShell
        slug="robotics-cd34"
        meeting={{ ...meetingFixture, status: "scheduled" }}
        workspace={workspaceFixture}
        stepParam="details"
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Who's invited?" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
  });

  it("sends Viewers to the meeting page", () => {
    renderWithProviders(
      <WizardShell
        slug="robotics-cd34"
        meeting={meetingFixture}
        workspace={{ ...workspaceFixture, myRole: "viewer" }}
        stepParam={null}
      />,
    );
    expect(replace).toHaveBeenCalledWith(
      `/w/robotics-cd34/meetings/${meetingFixture.id}`,
    );
  });
});
