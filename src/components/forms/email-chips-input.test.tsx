import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { EmailChipsInput } from "./email-chips-input";

function Harness({ initial = [] }: { initial?: string[] }) {
  const [emails, setEmails] = useState<string[]>(initial);
  return (
    <>
      <EmailChipsInput
        id="emails"
        label="Email addresses"
        value={emails}
        onChange={setEmails}
      />
      <output data-testid="value">{emails.join("|")}</output>
    </>
  );
}

const value = () => screen.getByTestId("value").textContent;
const field = () => screen.getByLabelText("Email addresses");

describe("EmailChipsInput", () => {
  it("turns an address into a chip on comma, space or Enter", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.type(field(), "a@x.test,b@y.test c@z.test{Enter}");
    expect(value()).toBe("a@x.test|b@y.test|c@z.test");
    expect(field()).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Remove b@y.test" }),
    ).toBeInTheDocument();
  });

  it("splits a pasted list, normalizes case and drops duplicates", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={["a@x.test"]} />);
    await user.click(field());
    await user.paste(" A@X.test; Lina@Example.TEST\nsami@example.test ");
    expect(value()).toBe("a@x.test|lina@example.test|sami@example.test");
  });

  it("keeps a typed address when the field loses focus", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.type(field(), "late@x.test");
    await user.tab();
    expect(value()).toBe("late@x.test");
  });

  it("removes the last chip with Backspace and any chip with its button", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Harness initial={["a@x.test", "b@y.test", "c@z.test"]} />,
    );
    await user.click(field());
    await user.keyboard("{Backspace}");
    expect(value()).toBe("a@x.test|b@y.test");
    await user.click(screen.getByRole("button", { name: "Remove a@x.test" }));
    expect(value()).toBe("b@y.test");
  });

  it("flags invalid addresses so they can be fixed", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.type(field(), "not-an-email ");
    expect(
      screen
        .getByText("not-an-email", { selector: "span" })
        .closest("[data-invalid]"),
    ).not.toBeNull();
  });
});
