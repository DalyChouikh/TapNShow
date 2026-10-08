import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { routeFetch } from "@/test/fetch";
import { MEETING_IDS } from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import { AddPeopleSheet } from "./add-people-sheet";

const path = `POST /api/workspaces/club-ab12/meetings/${MEETING_IDS.meeting}/people`;

describe("AddPeopleSheet", () => {
  it("adds several people from rows and a paste, saved to the roster by default", async () => {
    const fetchMock = routeFetch({
      [path]: () =>
        new Response(
          JSON.stringify({
            contactIds: [
              MEETING_IDS.amira,
              MEETING_IDS.lina,
              MEETING_IDS.youssef,
            ],
          }),
        ),
    });
    const onOpenChange = vi.fn();
    renderWithProviders(
      <AddPeopleSheet
        open
        onOpenChange={onOpenChange}
        slug="club-ab12"
        meetingId={MEETING_IDS.meeting}
      />,
      { toaster: true },
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Full name" }),
      "Nour Hamdi",
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Email" }),
      "nour@uni.tn",
    );
    await userEvent.click(screen.getByRole("button", { name: "Paste a list" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "One person per line: name, email" }),
      "Sami, sami@uni.tn{enter}Lina <lina@uni.tn>",
    );
    await userEvent.click(screen.getByRole("button", { name: "Use these 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Add 3 people" }));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toEqual({
      people: [
        { fullName: "Nour Hamdi", email: "nour@uni.tn" },
        { fullName: "Sami", email: "sami@uni.tn" },
        { fullName: "Lina", email: "lina@uni.tn" },
      ],
      saveToRoster: true,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(await screen.findByText("Added 3 people")).toBeInTheDocument();
  });

  it("blocks rows with a missing name or a bad email", async () => {
    const fetchMock = routeFetch({});
    renderWithProviders(
      <AddPeopleSheet
        open
        onOpenChange={vi.fn()}
        slug="club-ab12"
        meetingId={MEETING_IDS.meeting}
      />,
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Email" }),
      "nope",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add 1 person" }));
    expect(screen.getByText("Add a name.")).toBeInTheDocument();
    expect(screen.getByText("Check this email.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
