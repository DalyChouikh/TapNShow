import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { toast } from "sonner";
import { afterEach, describe, expect, it } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { renderWithProviders } from "@/test/render";
import type { Contact } from "@/shared/api/roster";
import { useDeferredDelete } from "./use-deferred-delete";

const AMIRA: Contact = {
  id: "7c2f8a1e-3b4d-4e5f-8a6b-1c2d3e4f5a61",
  email: "amira@example.test",
  fullName: "Amira",
  listIds: [],
};

function RosterPage({ slug }: { slug: string }) {
  const { pendingIds, scheduleDelete } = useDeferredDelete(slug);
  return (
    <div>
      <p data-testid="pending">{[...pendingIds].join(",")}</p>
      <button type="button" onClick={() => scheduleDelete([AMIRA])}>
        delete
      </button>
    </div>
  );
}

/** The roster page comes and goes (in-app navigation) while the global toaster stays. */
function App({ slug }: { slug: string }) {
  const [onRoster, setOnRoster] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOnRoster((value) => !value)}>
        navigate
      </button>
      {onRoster ? <RosterPage slug={slug} /> : null}
    </>
  );
}

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
});

describe("useDeferredDelete", () => {
  it("keeps a pending delete hidden after leaving the page and coming back", async () => {
    routeFetch({
      [`DELETE /api/workspaces/club-1/contacts/${AMIRA.id}`]: json({
        ok: true,
      }),
    });
    renderWithProviders(<App slug="club-1" />, { toaster: true });
    await userEvent.click(screen.getByRole("button", { name: "delete" }));
    await userEvent.click(screen.getByRole("button", { name: "navigate" }));
    await userEvent.click(screen.getByRole("button", { name: "navigate" }));
    expect(screen.getByTestId("pending")).toHaveTextContent(AMIRA.id);
  });

  it("forgets the person once the delete was sent while the page was away", async () => {
    const fetchMock = routeFetch({
      [`DELETE /api/workspaces/club-2/contacts/${AMIRA.id}`]: json({
        ok: true,
      }),
    });
    renderWithProviders(<App slug="club-2" />, { toaster: true });
    await userEvent.click(screen.getByRole("button", { name: "delete" }));
    await userEvent.click(screen.getByRole("button", { name: "navigate" }));
    act(() => {
      toast.dismiss();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "navigate" }));
    await waitFor(() =>
      expect(screen.getByTestId("pending")).toHaveTextContent(""),
    );
    expect(screen.getByTestId("pending").textContent).toBe("");
  });
});
