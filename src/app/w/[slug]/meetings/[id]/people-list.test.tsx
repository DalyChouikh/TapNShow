import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { MEETING_IDS, peopleFixture } from "@/test/fixtures/meetings";
import { setWideViewport } from "@/test/match-media";
import { renderWithProviders } from "@/test/render";
import { PeopleList } from "./people-list";

const base = `/api/workspaces/club-ab12/meetings/${MEETING_IDS.meeting}/people`;

function setup(filter = "all") {
  routeFetch({
    [`GET ${base}?filter=${filter}&limit=50`]: json({
      items: [peopleFixture[0]],
      nextCursor: "c1",
    }),
    [`GET ${base}?filter=${filter}&limit=50&cursor=c1`]: json({
      items: [peopleFixture[1]],
      nextCursor: null,
    }),
  });
  return renderWithProviders(
    <PeopleList
      slug="club-ab12"
      meetingId={MEETING_IDS.meeting}
      filter="all"
      live={false}
      timezone="Africa/Tunis"
    />,
  );
}

afterEach(() => setWideViewport(false));

describe("PeopleList", () => {
  it("shows answers with delay, reason and the deadline flag, then loads more", async () => {
    setup();
    expect(await screen.findByText("Late by 20 min")).toBeInTheDocument();
    expect(screen.getByText("Bus from campus")).toBeInTheDocument();
    expect(screen.getByText("after the deadline")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Amira B." })).toHaveAttribute(
      "href",
      `/w/club-ab12/lists?person=${MEETING_IDS.amira}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByText("Youssef K.")).toBeInTheDocument();
    // A one-off guest has no person sheet to open.
    expect(screen.queryByRole("link", { name: "Youssef K." })).toBeNull();
    expect(screen.getByText("Email not delivered")).toBeInTheDocument();
    expect(screen.getByText("That's everyone")).toBeInTheDocument();
  });

  it("renders reasons as text, never HTML (Review Focus 4)", async () => {
    routeFetch({
      [`GET ${base}?filter=all&limit=50`]: json({
        items: [
          {
            ...peopleFixture[0],
            answer: { ...peopleFixture[0].answer, reason: "<b>x</b>" },
          },
        ],
        nextCursor: null,
      }),
    });
    const { container } = renderWithProviders(
      <PeopleList
        slug="club-ab12"
        meetingId={MEETING_IDS.meeting}
        filter="all"
        live={false}
        timezone="Africa/Tunis"
      />,
    );
    expect(await screen.findByText("<b>x</b>")).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
  });

  it("is a table on wide screens", async () => {
    setWideViewport(true);
    setup();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    for (const name of ["Name", "Answer", "Reason", "Comment", "Answered"]) {
      expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
    }
  });
});
