// ABOUTME: Tests for the structured event logger — line shape, field pruning,
// ABOUTME: and the credential-shaped field-name redaction that keeps secrets out of logs.
import { describe, expect, it, vi } from "vitest";
import { logEvent } from "./log";

describe("logEvent", () => {
  it("writes one line of JSON with the event name first", () => {
    const sink = vi.fn();

    logEvent("cron_refresh", { refreshed: 3, fetch_errors: 0 }, sink);

    expect(sink).toHaveBeenCalledTimes(1);
    const line = sink.mock.calls[0][0];
    expect(line).toBe('{"event":"cron_refresh","refreshed":3,"fetch_errors":0}');
    expect(line).not.toContain("\n");
  });

  it("keeps a multi-line value on a single line", () => {
    const sink = vi.fn();

    logEvent("cron_failed", { message: "Error: boom\n    at somewhere" }, sink);

    expect(sink.mock.calls[0][0]).not.toContain("\n");
    expect(JSON.parse(sink.mock.calls[0][0]).message).toBe("Error: boom\n    at somewhere");
  });

  it("omits undefined fields rather than emitting nulls", () => {
    const sink = vi.fn();

    logEvent("matching_call", { group_id: undefined, session_id: "sess-1" }, sink);

    expect(JSON.parse(sink.mock.calls[0][0])).toEqual({ event: "matching_call", session_id: "sess-1" });
  });

  it("redacts values whose field name looks like a credential", () => {
    const sink = vi.fn();

    logEvent(
      "provider_auth_failed",
      {
        api_key: "sk-ant-real",
        token_hash: "abc123",
        jwt: "header.payload.sig",
        client_secret: "goog-secret",
        cookie: "mn-session=…",
        authorization: "Bearer x",
        password: "hunter2",
        status: 401,
      },
      sink
    );

    expect(JSON.parse(sink.mock.calls[0][0])).toEqual({
      event: "provider_auth_failed",
      api_key: "[redacted]",
      token_hash: "[redacted]",
      jwt: "[redacted]",
      client_secret: "[redacted]",
      cookie: "[redacted]",
      authorization: "[redacted]",
      password: "[redacted]",
      status: 401,
    });
  });

  it("redacts an email address but leaves a user id alone", () => {
    const sink = vi.fn();

    logEvent("auth_failed", { user_id: "user-42", email: "sam@example.com" }, sink);

    expect(JSON.parse(sink.mock.calls[0][0])).toEqual({
      event: "auth_failed",
      user_id: "user-42",
      email: "[redacted]",
    });
  });

  it("defaults to console.log when no sink is given", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      logEvent("cron_started", { cron: "0 9 * * 1" });
      expect(spy).toHaveBeenCalledWith('{"event":"cron_started","cron":"0 9 * * 1"}');
    } finally {
      spy.mockRestore();
    }
  });
});
