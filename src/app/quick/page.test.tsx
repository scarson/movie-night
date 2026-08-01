// @vitest-environment jsdom
// ABOUTME: Tests for quick match — one screen, tag-free submit, the 3-tag ceiling,
// ABOUTME: the solo-hidden rough-day toggle, and the session-then-match hand-off.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { AuthProvider } from "@/components/auth-provider";

const push = vi.fn();
const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));

import Quick from "@/app/quick/page";

const ALICE = { userId: "u1", email: "alice@example.com", name: "Alice Chen", avatarUrl: null };
const BOB = { userId: "u2", name: "Bob Reyes", avatarUrl: null };

interface StubOptions {
  session?: { status: number; body: unknown };
  match?: { status: number; body: unknown };
}

/** Reads `overrides` at request time, so a test may flip a route mid-flow. */
function stubApi(overrides: StubOptions = {}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      }
      if (url === "/api/auth/me") return new Response(JSON.stringify(ALICE), { status: 200 });
      if (url.startsWith("/api/groups/")) {
        return new Response(
          JSON.stringify({ group: { id: "g1", name: "Sunday Nights", members: [ALICE, BOB] } }),
          { status: 200 }
        );
      }
      if (url === "/api/movie-sessions") {
        const c = overrides.session ?? { status: 200, body: { sessionId: "s1" } };
        return new Response(JSON.stringify(c.body), { status: c.status });
      }
      if (url.endsWith("/match")) {
        const m = overrides.match ?? { status: 200, body: { round: 1 } };
        return new Response(JSON.stringify(m.body), { status: m.status });
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    })
  );
  return calls;
}

async function settleNarrative() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}

async function renderQuick() {
  render(
    <AuthProvider>
      <Quick />
    </AuthProvider>
  );
  await screen.findByRole("button", { name: /find our match/i });
}

beforeEach(() => {
  search = "";
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("quick match", () => {
  it("submits with no tags at all and hands off to results", async () => {
    const calls = stubApi();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderQuick();

    fireEvent.click(screen.getByRole("button", { name: /find our match/i }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].url).toBe("/api/movie-sessions");
    expect(calls[0].body).toMatchObject({
      groupId: null,
      moodVibes: [],
      moodText: "",
      isQuickMatch: true,
    });
    expect(calls[1].url).toBe("/api/movie-sessions/s1/match");

    await settleNarrative();
    expect(push).toHaveBeenCalledWith("/results/s1");
  });

  it("sends the chosen quick tags with the session", async () => {
    const calls = stubApi();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderQuick();

    fireEvent.click(screen.getByRole("checkbox", { name: "Cozy" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Funny" }));
    fireEvent.click(screen.getByRole("button", { name: /find our match/i }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].body).toMatchObject({ moodVibes: ["Cozy", "Funny"] });
  });

  it("stops at three tags rather than silently accepting a fourth", async () => {
    stubApi();
    await renderQuick();

    for (const tag of ["Cozy", "Funny", "Thrilling"]) {
      fireEvent.click(screen.getByRole("checkbox", { name: tag }));
    }
    const fourth = screen.getByRole("checkbox", { name: "Romantic" });
    fireEvent.click(fourth);

    expect(fourth.getAttribute("aria-checked")).toBe("false");
    // Deselecting one frees the slot again.
    fireEvent.click(screen.getByRole("checkbox", { name: "Cozy" }));
    fireEvent.click(fourth);
    expect(fourth.getAttribute("aria-checked")).toBe("true");
  });

  it("says why a fourth tag did nothing instead of ignoring the tap", async () => {
    stubApi();
    await renderQuick();

    for (const tag of ["Cozy", "Funny", "Thrilling"]) {
      fireEvent.click(screen.getByRole("checkbox", { name: tag }));
    }
    fireEvent.click(screen.getByRole("checkbox", { name: "Romantic" }));

    expect(screen.getByText(/remove one first/i)).toBeTruthy();

    // Freeing a slot clears the notice rather than leaving it stuck.
    fireEvent.click(screen.getByRole("checkbox", { name: "Cozy" }));
    expect(screen.queryByText(/remove one first/i)).toBeNull();
  });

  it("says the group could not be loaded rather than looking like a solo match", async () => {
    search = "group=g1";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/auth/me") {
          return new Response(JSON.stringify(ALICE), { status: 200 });
        }
        if (url.startsWith("/api/groups/")) {
          return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );
    await renderQuick();

    expect((await screen.findByRole("alert")).textContent).toMatch(/group/i);
    // The CTA still works — the group id in the URL is what the server matches on.
    expect(screen.getByRole("button", { name: /find our match/i })).toBeTruthy();
  });

  it("says it will surprise us while no tag is chosen", async () => {
    stubApi();
    await renderQuick();
    expect(screen.getByText(/surprise us/i)).toBeTruthy();
  });

  it("shows the group's members and carries the group id", async () => {
    search = "group=g1";
    const calls = stubApi();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderQuick();

    // Scoped to the "who's watching" line — Bob's name also appears on the
    // rough-day toggle, and that is a different guarantee.
    const watchingLine = (await screen.findByText(/Sunday Nights/)).closest("p");
    expect(watchingLine?.textContent).toContain("Alice Chen");
    expect(watchingLine?.textContent).toContain("Bob Reyes");

    fireEvent.click(screen.getByRole("button", { name: /find our match/i }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].body).toMatchObject({ groupId: "g1" });
  });

  it("offers the rough-day toggle only when someone else is watching", async () => {
    stubApi();
    await renderQuick();
    expect(screen.queryByRole("switch", { name: /rough day/i })).toBeNull();
  });

  it("carries the rough-day flag for the signed-in user only", async () => {
    search = "group=g1";
    const calls = stubApi();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderQuick();

    fireEvent.click(await screen.findByRole("switch", { name: "Bob Reyes had a rough day" }));
    fireEvent.click(screen.getByRole("button", { name: /find our match/i }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].body).toMatchObject({ roughDay: true });
    expect((calls[0].body as { memberFlags?: unknown }).memberFlags).toBeUndefined();
  });

  it("keeps the rough-day toggle for a group match even when member details fail to load", async () => {
    // The group id in the URL still drives a group session, so the caller must
    // keep the ability to flag a rough day for themselves — the toggle only
    // needs the signed-in user, and the flag is sent regardless.
    search = "group=g1";
    const calls: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (method !== "GET") {
          calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        }
        if (url === "/api/auth/me") return new Response(JSON.stringify(ALICE), { status: 200 });
        if (url.startsWith("/api/groups/")) {
          return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
        }
        if (url === "/api/movie-sessions") {
          return new Response(JSON.stringify({ sessionId: "s1" }), { status: 200 });
        }
        if (url.endsWith("/match")) {
          return new Response(JSON.stringify({ round: 1 }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${method} ${url}`);
      })
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderQuick();

    fireEvent.click(await screen.findByRole("switch", { name: /rough day/i }));
    fireEvent.click(screen.getByRole("button", { name: /find our match/i }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].body).toMatchObject({ groupId: "g1", roughDay: true });
    // Still only the caller's own flag — no other member's flag is sent.
    expect((calls[0].body as { memberFlags?: unknown }).memberFlags).toBeUndefined();
  });

  it("surfaces a failed match against the session already created", async () => {
    const calls = stubApi({
      match: { status: 429, body: { error: "You've hit tonight's refinement limit", kind: "round_limit" } },
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderQuick();

    fireEvent.click(screen.getByRole("button", { name: /find our match/i }));
    await waitFor(() => expect(calls).toHaveLength(2));
    await settleNarrative();

    expect((await screen.findByRole("alert")).textContent).toContain("refinement limit");
    expect(push).not.toHaveBeenCalled();
  });

  // Holds on both sides of the sessionId fix, because submit() calls
  // startSession unconditionally. What it guards is the forbidden alternative:
  // making submit() reuse a non-null sessionId, which would match the abandoned
  // brief. The test that discriminates the shipped fix is the one below it.
  it("changing the vibe and resubmitting starts exactly one new session", async () => {
    const calls = stubApi({
      match: { status: 503, body: { error: "The projectionist is having a nap.", kind: "timeout" } },
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderQuick();

    fireEvent.click(screen.getByRole("checkbox", { name: "Cozy" }));
    fireEvent.click(screen.getByRole("button", { name: /find our match/i }));
    await waitFor(() => expect(calls).toHaveLength(2));
    await settleNarrative();
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: /change the vibe/i }));

    // A different vibe: the second session must carry this one, not the first.
    fireEvent.click(await screen.findByRole("checkbox", { name: "Cozy" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Thrilling" }));
    fireEvent.click(screen.getByRole("button", { name: /find our match/i }));

    await waitFor(() => expect(calls).toHaveLength(4));
    const sessionPosts = calls.filter((c) => c.url === "/api/movie-sessions");
    expect(sessionPosts).toHaveLength(2);
    expect(sessionPosts[0].body).toMatchObject({ moodVibes: ["Cozy"] });
    expect(sessionPosts[1].body).toMatchObject({ moodVibes: ["Thrilling"] });
  });

  it("after changing the vibe, a failed session create leaves nothing to retry the old vibe against", async () => {
    // The discriminating case for the back-edge. If the session id survives
    // "Change the vibe", the resubmit's create failure falls back on the first
    // session, and "Try again" re-runs the vibe the user just abandoned —
    // behind a button whose label promises the opposite.
    const options: StubOptions = {
      match: { status: 503, body: { error: "The projectionist is having a nap.", kind: "timeout" } },
    };
    const calls = stubApi(options);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderQuick();

    fireEvent.click(screen.getByRole("checkbox", { name: "Cozy" }));
    fireEvent.click(screen.getByRole("button", { name: /find our match/i }));
    await waitFor(() => expect(calls).toHaveLength(2));
    await settleNarrative();
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: /change the vibe/i }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Cozy" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Thrilling" }));

    options.session = { status: 500, body: { error: "Couldn't start that." } };
    fireEvent.click(screen.getByRole("button", { name: /find our match/i }));
    await waitFor(() => expect(calls).toHaveLength(3));
    await settleNarrative();
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(calls).toHaveLength(4));

    // Retrying must attempt a fresh session, never re-match the abandoned one.
    expect(calls[3].url).toBe("/api/movie-sessions");
    expect(calls[3].body).toMatchObject({ moodVibes: ["Thrilling"] });
    expect(calls.filter((c) => c.url === "/api/movie-sessions/s1/match")).toHaveLength(1);
  });

  it("'Try again' still reuses the existing session", async () => {
    const calls = stubApi({
      match: { status: 503, body: { error: "The projectionist is having a nap.", kind: "timeout" } },
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderQuick();

    fireEvent.click(screen.getByRole("button", { name: /find our match/i }));
    await waitFor(() => expect(calls).toHaveLength(2));
    await settleNarrative();
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].url).toBe("/api/movie-sessions/s1/match");
    expect(calls.filter((c) => c.url === "/api/movie-sessions")).toHaveLength(1);
  });

  it("sends the signed-out visitor home", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }))
    );
    render(
      <AuthProvider>
        <Quick />
      </AuthProvider>
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });
});
