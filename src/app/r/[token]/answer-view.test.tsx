import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Answer } from "@/shared/api/responses";
import type { TokenInfo } from "@/shared/api/tokens";
import { json, routeFetch } from "@/test/fetch";
import { tokenInfoFixture } from "@/test/fixtures/tokens";
import { renderWithProviders } from "@/test/render";
import { AnswerView } from "./answer-view";

const TOKEN = "a".repeat(43);
const NOW = new Date().toISOString();
const navigation = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ token: "a".repeat(43) }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

type Overrides = Partial<Omit<TokenInfo, "meeting" | "answers">> & {
  meeting?: Partial<TokenInfo["meeting"]>;
  answers?: Partial<TokenInfo["answers"]>;
};

let calls: { method: string; body: string }[] = [];
let putResponse: () => Response;

function answerFrom(body: string): Answer {
  const sent = JSON.parse(body) as Pick<
    Answer,
    "status" | "delayMinutes" | "reason" | "comment"
  >;
  return { ...sent, afterDeadline: false, respondedAt: NOW, updatedAt: NOW };
}

function renderWith(search: string, overrides: Overrides = {}) {
  navigation.search = search;
  const info: TokenInfo = {
    ...tokenInfoFixture,
    ...overrides,
    meeting: {
      ...tokenInfoFixture.meeting,
      startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      ...overrides.meeting,
    },
    answers: { ...tokenInfoFixture.answers, ...overrides.answers },
  };
  routeFetch({
    [`GET /api/r/${TOKEN}`]: json(info),
    [`PUT /api/r/${TOKEN}/response`]: (init) => {
      calls.push({ method: "PUT", body: String(init?.body) });
      return putResponse();
    },
    [`POST /api/r/${TOKEN}/calendar`]: (init) => {
      calls.push({ method: "POST", body: String(init?.body) });
      return new Response(JSON.stringify({ ok: true }));
    },
  });
  return renderWithProviders(<AnswerView />);
}

const fetchCalls = (method: string) => calls.filter((c) => c.method === method);

beforeEach(() => {
  calls = [];
  putResponse = () =>
    new Response(JSON.stringify(answerFrom(calls.at(-1)?.body ?? "{}")));
});

describe("AnswerView", () => {
  it("pre-selects the email's choice and saves nothing until Confirm (Review Focus 1)", async () => {
    renderWith("choice=late");
    expect(
      await screen.findByRole("radio", { name: "I'll be late" }),
    ).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Confirm: I'll be late" }),
    ).toBeInTheDocument();
    expect(fetchCalls("PUT")).toHaveLength(0);
  });

  it("ignores a choice the meeting doesn't offer", async () => {
    renderWith("choice=not_going");
    await screen.findByText("Are you coming?");
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).not.toBeChecked();
    }
  });

  it("asks for a delay and a reason before saving Late", async () => {
    renderWith("choice=late");
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm: I'll be late" }),
    );
    expect(
      await screen.findByText("Pick how late you'll be."),
    ).toBeInTheDocument();
    expect(screen.getByText("Please add a reason.")).toBeInTheDocument();
    expect(fetchCalls("PUT")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "20 min" }));
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Bus from campus" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm: late by 20 min" }),
    );
    await waitFor(() => expect(fetchCalls("PUT")).toHaveLength(1));
    expect(JSON.parse(fetchCalls("PUT")[0].body)).toEqual({
      status: "late",
      delayMinutes: 20,
      reason: "Bus from campus",
      comment: "",
    });
    expect(await screen.findByText("CONFIRMED")).toBeInTheDocument();
    expect(screen.getByText("Your answer: Late by 20 min")).toBeInTheDocument();
    expect(
      screen.getByText("We emailed you a calendar invite."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("answer-summary")).toHaveFocus(),
    );
  });

  it("saves Going in one tap, without a reason box", async () => {
    renderWith("choice=attending");
    await screen.findByRole("radio", { name: "I'm going" });
    expect(screen.queryByLabelText(/Reason/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirm: I'm going" }));
    expect(await screen.findByText("Your answer: Going")).toBeInTheDocument();
  });

  it("keeps the reason optional when the meeting doesn't ask for one", async () => {
    renderWith("choice=absent", { answers: { reasonRequired: false } });
    expect(
      await screen.findByLabelText("Reason (optional)"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm: I can't come" }),
    );
    await waitFor(() => expect(fetchCalls("PUT")).toHaveLength(1));
  });

  it("shows a saved answer with Change, and Change keeps the values", async () => {
    renderWith("", {
      answer: {
        status: "absent",
        delayMinutes: null,
        reason: "Exam",
        comment: "",
        afterDeadline: false,
        respondedAt: NOW,
        updatedAt: NOW,
      },
    });
    expect(
      await screen.findByText("Your answer: Can't come"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("radio", { name: "I can't come" })).toBeChecked();
    expect(screen.getByLabelText("Reason")).toHaveValue("Exam");
  });

  it("pre-selects a different email choice over a saved answer, keeping its reason, until Confirm", async () => {
    renderWith("choice=late", {
      answer: {
        status: "absent",
        delayMinutes: null,
        reason: "Exam",
        comment: "",
        afterDeadline: false,
        respondedAt: NOW,
        updatedAt: NOW,
      },
    });
    expect(
      await screen.findByRole("radio", { name: "I'll be late" }),
    ).toBeChecked();
    expect(screen.queryByText("Your answer: Can't come")).toBeNull();
    expect(screen.getByLabelText("Reason")).toHaveValue("Exam");
    expect(fetchCalls("PUT")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "20 min" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm: late by 20 min" }),
    );
    expect(
      await screen.findByText("Your answer: Late by 20 min"),
    ).toBeInTheDocument();
  });

  it("shows the saved answer when the email choice matches it", async () => {
    renderWith("choice=absent", {
      answer: {
        status: "absent",
        delayMinutes: null,
        reason: "Exam",
        comment: "",
        afterDeadline: false,
        respondedAt: NOW,
        updatedAt: NOW,
      },
    });
    expect(
      await screen.findByText("Your answer: Can't come"),
    ).toBeInTheDocument();
  });

  it("is read-only after the start (Review Focus 3)", async () => {
    renderWith("choice=attending", {
      meeting: { startsAt: new Date(Date.now() - 60_000).toISOString() },
    });
    expect(
      await screen.findByText(
        "The meeting has started, so answers are closed.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("keeps answering open after the deadline and says so", async () => {
    renderWith("", {
      answers: {
        responseDeadline: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    expect(
      await screen.findByText(
        "The answer deadline has passed. You can still answer.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("shows a reason as text, never as HTML (Review Focus 4)", async () => {
    const { container } = renderWith("", {
      answer: {
        status: "absent",
        delayMinutes: null,
        reason: "<img src=x onerror=alert(1)>",
        comment: "",
        afterDeadline: false,
        respondedAt: NOW,
        updatedAt: NOW,
      },
    });
    expect(
      await screen.findByText("<img src=x onerror=alert(1)>"),
    ).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("offers two choices for RSVP", async () => {
    renderWith("choice=going", { answers: { responseMode: "rsvp" } });
    expect(await screen.findByRole("radio", { name: "Going" })).toBeChecked();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Confirm: going" }),
    ).toBeInTheDocument();
  });

  it("offers Google Calendar and a calendar file after a Going answer, writing nothing", async () => {
    renderWith("", {
      answer: {
        status: "attending",
        delayMinutes: null,
        reason: "",
        comment: "",
        afterDeadline: false,
        respondedAt: NOW,
        updatedAt: NOW,
      },
    });
    const google = await screen.findByRole("link", {
      name: "Add to Google Calendar",
    });
    expect(google.getAttribute("href")).toMatch(
      /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&text=/,
    );
    expect(google).toHaveAttribute("target", "_blank");
    expect(
      screen.getByRole("link", { name: "Download calendar file" }),
    ).toHaveAttribute("href", `/api/r/${TOKEN}/ics`);
    expect(calls).toHaveLength(0);
  });

  it("offers no calendar links after I can't come", async () => {
    renderWith("", {
      answer: {
        status: "absent",
        delayMinutes: null,
        reason: "Exam",
        comment: "",
        afterDeadline: false,
        respondedAt: NOW,
        updatedAt: NOW,
      },
    });
    expect(
      await screen.findByText("Your answer: Can't come"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Add to Google Calendar" }),
    ).toBeNull();
  });

  it("offers the calendar links on an announcement", async () => {
    renderWith("", { answers: { responseMode: "announcement" } });
    expect(
      await screen.findByRole("link", { name: "Download calendar file" }),
    ).toBeInTheDocument();
  });

  it("offers the calendar email on an announcement", async () => {
    renderWith("", { answers: { responseMode: "announcement" } });
    fireEvent.click(
      await screen.findByRole("button", { name: "Email me a calendar invite" }),
    );
    await waitFor(() => expect(fetchCalls("POST")).toHaveLength(1));
    expect(
      await screen.findByText("We emailed you a calendar invite."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Your answer is visible/)).toBeNull();
  });

  it("tells an unsubscribed member that no calendar email comes", async () => {
    renderWith("choice=attending", { unsubscribed: true });
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm: I'm going" }),
    );
    expect(
      await screen.findByText(/won't email you a calendar invite/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Subscribe again" }),
    ).toHaveAttribute("href", `/u/${TOKEN}`);
  });

  it("moves to the closed state when the server says answers closed meanwhile", async () => {
    putResponse = () =>
      new Response(JSON.stringify({ error: { code: "answers_closed" } }), {
        status: 409,
      });
    renderWith("choice=attending");
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm: I'm going" }),
    );
    expect(
      await screen.findByText(
        "The meeting has started, so answers are closed.",
      ),
    ).toBeInTheDocument();
  });

  it("explains that the link is personal", async () => {
    renderWith("");
    fireEvent.click(await screen.findByRole("button", { name: "Not you?" }));
    expect(
      await screen.findByText("This link is personal"),
    ).toBeInTheDocument();
  });
});
