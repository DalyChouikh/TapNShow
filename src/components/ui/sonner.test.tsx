import { act, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { describe, expect, it } from "vitest";
import { Toaster } from "./sonner";

describe("Toaster", () => {
  it("announces toasts in the app style", async () => {
    render(<Toaster />);
    act(() => {
      toast("Saved.");
    });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });
});
