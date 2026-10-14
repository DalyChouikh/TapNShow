import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { renderWithProviders } from "@/test/render";
import { DisplayNameForm } from "./display-name-form";

afterEach(() => vi.unstubAllGlobals());

describe("DisplayNameForm", () => {
  it("saves the trimmed name and says so", async () => {
    const fetchMock = routeFetch({ "PATCH /api/me": json({ ok: true }) });
    const user = userEvent.setup();
    renderWithProviders(<DisplayNameForm initialName="Amira" />, {
      toaster: true,
    });
    const field = screen.getByLabelText("Name");
    await user.clear(field);
    await user.type(field, "  Amira B. ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Name saved.")).toBeVisible();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      displayName: "Amira B.",
    });
  });

  it("refuses an empty name without calling the server", async () => {
    const fetchMock = routeFetch({});
    const user = userEvent.setup();
    renderWithProviders(<DisplayNameForm initialName="Amira" />);
    await user.clear(screen.getByLabelText("Name"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        screen.getByText("Enter a name between 1 and 80 characters."),
      ).toBeVisible(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps what the person is typing when the profile refetches", async () => {
    const user = userEvent.setup();
    const refetch: { set: (name: string) => void } = { set: () => {} };
    function Harness() {
      const [name, setName] = useState("Amira");
      refetch.set = setName;
      return <DisplayNameForm initialName={name} />;
    }
    renderWithProviders(<Harness />);
    const field = screen.getByLabelText("Name");
    await user.clear(field);
    await user.type(field, "Amira B.");
    act(() => refetch.set("Amira (refetched)"));
    expect(screen.getByLabelText("Name")).toHaveValue("Amira B.");
  });
});
