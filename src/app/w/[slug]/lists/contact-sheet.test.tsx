import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { IDS, rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { ContactSheet } from "./contact-sheet";

const youssef = rosterFixture.contacts[2];
const base = `/api/workspaces/club-ab12`;

function renderSheet(canEdit = true) {
  const onDelete = vi.fn();
  renderWithProviders(
    <ContactSheet
      slug="club-ab12"
      contact={youssef}
      roster={rosterFixture}
      canEdit={canEdit}
      onClose={vi.fn()}
      onDelete={onDelete}
    />,
  );
  return { onDelete };
}

describe("ContactSheet", () => {
  it("saves a changed name when the field loses focus", async () => {
    const fetchMock = routeFetch({
      [`PATCH ${base}/contacts/${IDS.youssef}`]: json({ ok: true }),
      [`GET ${base}/contacts`]: json(rosterFixture),
    });
    const user = userEvent.setup();
    renderSheet();
    const name = screen.getByLabelText("Full name");
    await user.clear(name);
    await user.type(name, "Youssef T.");
    await user.tab();
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(IDS.youssef) && init?.method === "PATCH",
    );
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      fullName: "Youssef T.",
    });
  });

  it("names the person who already has an email", async () => {
    routeFetch({
      [`PATCH ${base}/contacts/${IDS.youssef}`]: json(
        { error: { code: "contact_email_taken" } },
        409,
      ),
      [`GET ${base}/contacts`]: json(rosterFixture),
    });
    const user = userEvent.setup();
    renderSheet();
    const email = screen.getByLabelText("Email");
    await user.clear(email);
    await user.type(email, "SARRA@example.com");
    await user.tab();
    expect(
      await screen.findByText("Already in your roster: Sarra Khelifi"),
    ).toBeInTheDocument();
  });

  it("refuses an invalid email without calling the API", async () => {
    const fetchMock = routeFetch({});
    const user = userEvent.setup();
    renderSheet();
    const email = screen.getByLabelText("Email");
    await user.clear(email);
    await user.type(email, "not-an-email");
    await user.tab();
    expect(
      screen.getByText("Enter a valid email address."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds and removes lists, and deletes through the parent", async () => {
    const fetchMock = routeFetch({
      [`PATCH ${base}/contacts/${IDS.youssef}`]: json({ ok: true }),
      [`GET ${base}/contacts`]: json(rosterFixture),
    });
    const user = userEvent.setup();
    const { onDelete } = renderSheet();
    await user.click(screen.getByRole("button", { name: "Add to a list" }));
    await user.click(screen.getByRole("option", { name: "Dev" }));
    const bodies = () =>
      fetchMock.mock.calls
        .filter(([, init]) => init?.method === "PATCH")
        .map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies()).toContainEqual({ listIds: [IDS.dev] });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(youssef);
  });

  it("is read-only for Viewers", () => {
    renderSheet(false);
    expect(screen.getByRole("heading", { name: "Person" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Full name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(
      screen.getByText("Only Owners and Admins can edit the roster."),
    ).toBeInTheDocument();
  });
});
