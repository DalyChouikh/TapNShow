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
        modeParam={null}
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
        modeParam={null}
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
        modeParam={null}
      />,
    );
    expect(replace).toHaveBeenCalledWith(
      `/w/robotics-cd34/meetings/${meetingFixture.id}`,
    );
  });

  it("edits a sent meeting in three steps with ?mode=edit (M6)", () => {
    renderWithProviders(
      <WizardShell
        slug="robotics-cd34"
        meeting={{
          ...meetingFixture,
          status: "scheduled",
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        }}
        workspace={workspaceFixture}
        stepParam="responses"
        modeParam="edit"
      />,
    );
    expect(screen.getByText("Edit meeting · Step 2 of 3")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends an edit of a meeting that already started back to its page", () => {
    renderWithProviders(
      <WizardShell
        slug="robotics-cd34"
        meeting={{
          ...meetingFixture,
          status: "scheduled",
          startsAt: new Date(Date.now() - 60_000).toISOString(),
        }}
        workspace={workspaceFixture}
        stepParam="details"
        modeParam="edit"
      />,
    );
    expect(replace).toHaveBeenCalledWith(
      `/w/robotics-cd34/meetings/${meetingFixture.id}`,
    );
  });
});
