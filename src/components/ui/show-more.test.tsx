import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { ShowMore } from "./show-more";

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

describe("ShowMore", () => {
  it("loads the next page on tap", () => {
    const onMore = vi.fn();
    render(wrap(<ShowMore hasMore loading={false} onMore={onMore} />));
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(onMore).toHaveBeenCalledOnce();
  });

  it("shows a busy button while loading and an end line when done", () => {
    const { rerender } = render(
      wrap(<ShowMore hasMore loading onMore={vi.fn()} />),
    );
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
    rerender(
      wrap(
        <ShowMore
          hasMore={false}
          loading={false}
          onMore={vi.fn()}
          endLabel="That's everyone"
        />,
      ),
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("That's everyone")).toBeInTheDocument();
  });
});
