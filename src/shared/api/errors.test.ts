import { describe, expect, it } from "vitest";
import messages from "../../../messages/en.json";
import { API_ERROR_CODES, API_ERROR_STATUS } from "./errors";

describe("ApiErrors messages", () => {
  it("translate every error code", () => {
    expect(
      API_ERROR_CODES.filter((code) => !(code in messages.ApiErrors)),
    ).toEqual([]);
  });
});

describe("M6 error codes", () => {
  it("map to the statuses the plan names", () => {
    expect({
      deadline_in_past: API_ERROR_STATUS.deadline_in_past,
      deadline_after_start: API_ERROR_STATUS.deadline_after_start,
      meeting_started: API_ERROR_STATUS.meeting_started,
      meeting_cancelled: API_ERROR_STATUS.meeting_cancelled,
      nudge_too_soon: API_ERROR_STATUS.nudge_too_soon,
      cancel_emails_pending: API_ERROR_STATUS.cancel_emails_pending,
      check_in_closed: API_ERROR_STATUS.check_in_closed,
    }).toEqual({
      deadline_in_past: 400,
      deadline_after_start: 400,
      meeting_started: 409,
      meeting_cancelled: 409,
      nudge_too_soon: 409,
      cancel_emails_pending: 409,
      check_in_closed: 409,
    });
  });
});
