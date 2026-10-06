import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { ProfileDialog } from "./profile-dialog";

describe("ProfileDialog", () => {
  it("keeps what the user is typing when the profile refetches", async () => {
    const user = userEvent.setup();
    const refetch: { set: (name: string) => void } = { set: () => {} };
    function Harness() {
      const [name, setName] = useState("Amira");
      refetch.set = setName;
      return <ProfileDialog open onOpenChange={() => {}} currentName={name} />;
    }
    renderWithProviders(<Harness />);
    const field = screen.getByLabelText("Name");
    await user.clear(field);
    await user.type(field, "Amira B.");
    act(() => refetch.set("Amira (refetched)"));
    expect(screen.getByLabelText("Name")).toHaveValue("Amira B.");
  });
});
