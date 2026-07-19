// @vitest-environment jsdom
// ABOUTME: Tests for the full ritual — stepper order for N members, the profile PUT
// ABOUTME: payload, the session-then-match submit order, and the load-failure guard.
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

import Ritual from "@/app/ritual/page";

const ALICE = { userId: "u1", email: "alice@example.com", name: "Alice Chen", avatarUrl: null };
const BOB = { userId: "u2", name: "Bob Reyes", avatarUrl: null };

const SAVED_PROFILE = {
  comfortTitles: [1],
  watchlist: [],
  vibes: ["Cozy"],
  dealbreakers: [],
  streamingServices: ["Netflix"],
};

const ARRIVAL = { tmdbId: 1, title: "Arrival", year: 2016, posterPath: "/a.jpg" };

interface StubOptions {
  profile?: { status: number; body: unknown };
  group?: { status: number; body: unknown };
  session?: { status: number; body: unknown };
  match?: { status: number; body: unknown };
}

/** Records every non-GET call so submit ordering can be asserted. */
function stubApi(options: StubOptions = {}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (method !== "GET") calls.push({ url, method, body });

      if (url === "/api/auth/me") return new Response(JSON.stringify(ALICE), { status: 200 });
      if (url === "/api/user/profile" && method === "GET") {
        const p = options.profile ?? { status: 200, body: { profile: SAVED_PROFILE } };
        return new Response(JSON.stringify(p.body), { status: p.status });
      }
      if (url === "/api/user/profile" && method === "PUT") {
        return new Response(JSON.stringify({ profile: SAVED_PROFILE }), { status: 200 });
      }
      if (url.startsWith("/api/titles/search?ids=")) {
        return new Response(JSON.stringify({ results: [ARRIVAL] }), { status: 200 });
      }
      if (url.startsWith("/api/titles/search?popular=")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      if (url.startsWith("/api/groups/")) {
        const g = options.group ?? {
          status: 200,
          body: { group: { id: "g1", name: "Sunday Nights", members: [ALICE, BOB] } },
        };
        return new Response(JSON.stringify(g.body), { status: g.status });
      }
      if (url === "/api/movie-sessions") {
        const s = options.session ?? { status: 200, body: { sessionId: "s1" } };
        return new Response(JSON.stringify(s.body), { status: s.status });
      }
      if (url.endsWith("/match")) {
        const m = options.match ?? { status: 200, body: { round: 1 } };
        return new Response(JSON.stringify(m.body), { status: m.status });
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    })
  );
  return calls;
}

async function renderRitual() {
  const result = render(
    <AuthProvider>
      <Ritual />
    </AuthProvider>
  );
  await screen.findByRole("navigation", { name: /progress/i });
  return result;
}

/**
 * Drives PhasedLoading's narrative to its end. Each phase's timer is scheduled by
 * the effect that runs after the previous phase renders, so the advances have to
 * be flushed one at a time — a single large advance only ever fires phase one.
 */
async function settleNarrative() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}

function stepLabels(): string[] {
  return Array.from(
    document.querySelectorAll('nav[aria-label="Ritual progress"] ol > li')
  ).map((li) => li.textContent?.replace(/^[✓\d]/, "").trim() ?? "");
}

beforeEach(() => {
  search = "";
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ritual stepper", () => {
  it("shows one step per member then Mood, with the signed-in user first", async () => {
    search = "group=g1";
    stubApi();
    await renderRitual();

    await waitFor(() => expect(stepLabels()).toEqual(["Alice Chen", "Bob Reyes", "Mood"]));
  });

  it("runs solo with no group step when no group is given", async () => {
    stubApi();
    await renderRitual();

    await waitFor(() => expect(stepLabels()).toEqual(["Alice Chen", "Mood"]));
  });

  it("pre-fills the editor from the saved profile, resolving title ids to names", async () => {
    stubApi();
    await renderRitual();

    expect(await screen.findByRole("checkbox", { name: /Arrival/ })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Netflix" }).getAttribute("aria-checked")).toBe("true");
  });

  it("saves the profile as tmdb ids when advancing off the profile step", async () => {
    const calls = stubApi();
    await renderRitual();
    await screen.findByRole("checkbox", { name: /Arrival/ });

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      url: "/api/user/profile",
      method: "PUT",
      body: {
        comfortTitles: [1],
        watchlist: [],
        vibes: ["Cozy"],
        dealbreakers: [],
        streamingServices: ["Netflix"],
      },
    });
  });

  it("refuses to render the editor when the saved profile could not be loaded", async () => {
    stubApi({ profile: { status: 500, body: { error: "boom" } } });
    render(
      <AuthProvider>
        <Ritual />
      </AuthProvider>
    );

    expect(await screen.findByRole("alert")).toBeTruthy();
    // Rendering an empty editor would let "Continue" overwrite the saved profile.
    expect(screen.queryByRole("group", { name: /comfort/i })).toBeNull();
  });

  it("sends the signed-out visitor home", async () => {
    stubApi({ profile: { status: 401, body: { error: "Unauthorized" } } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }))
    );
    render(
      <AuthProvider>
        <Ritual />
      </AuthProvider>
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });
});

describe("ritual submit", () => {
  async function advanceToMood(calls: { url: string; method: string }[], steps: number) {
    await screen.findByRole("checkbox", { name: /Arrival/ });
    for (let i = 0; i < steps; i++) {
      fireEvent.click(screen.getByRole("button", { name: /continue/i }));
      // The profile PUT gates the first advance.
      if (i === 0) await waitFor(() => expect(calls).toHaveLength(1));
    }
    await screen.findByRole("group", { name: /session summary/i });
  }

  it("creates the session then requests the match, then lands on results", async () => {
    search = "group=g1";
    const calls = stubApi();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderRitual();
    await advanceToMood(calls, 2);

    fireEvent.click(screen.getByRole("button", { name: /find our match/i }));

    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[1].url).toBe("/api/movie-sessions");
    expect(calls[1].method).toBe("POST");
    expect(calls[1].body).toMatchObject({
      groupId: "g1",
      moodVibes: [],
      moodText: "",
      discoverNew: false,
      isQuickMatch: false,
      roughDay: false,
    });
    expect(calls[2].url).toBe("/api/movie-sessions/s1/match");
    expect(calls[2].method).toBe("POST");

    // The narrative has to land before the hand-off, per DESIGN.md's loading sequence.
    expect(push).not.toHaveBeenCalled();
    await settleNarrative();
    expect(push).toHaveBeenCalledWith("/results/s1");
  });

  it("carries a member's rough-day flag as memberFlags without a top-level leak", async () => {
    search = "group=g1";
    const calls = stubApi();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderRitual();
    await screen.findByRole("checkbox", { name: /Arrival/ });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(calls).toHaveLength(1));

    // Bob's own step: the toggle is named for the person it benefits.
    fireEvent.click(await screen.findByRole("switch", { name: "Alice Chen had a rough day" }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await screen.findByRole("group", { name: /session summary/i });

    fireEvent.click(screen.getByRole("button", { name: /find our match/i }));
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[1].body).toMatchObject({
      roughDay: false,
      memberFlags: { u2: { roughDay: true } },
    });
  });

  it("surfaces a failed match without creating a second session", async () => {
    const calls = stubApi({
      match: { status: 503, body: { error: "The projectionist is having a nap.", kind: "timeout" } },
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderRitual();
    await advanceToMood(calls, 1);

    fireEvent.click(screen.getByRole("button", { name: /find our match/i }));
    await waitFor(() => expect(calls).toHaveLength(3));

    await settleNarrative();
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("projectionist")
    );
    expect(push).not.toHaveBeenCalled();

    // Retry re-runs the match against the session already created.
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(calls).toHaveLength(4));
    expect(calls[3].url).toBe("/api/movie-sessions/s1/match");
    expect(calls.filter((c) => c.url === "/api/movie-sessions")).toHaveLength(1);
  });
});
