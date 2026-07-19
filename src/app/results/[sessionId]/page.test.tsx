// @vitest-environment jsdom
// ABOUTME: Tests for the results page — no match POST on mount, keyboard tabs, the
// ABOUTME: refinement round trip with accumulating removed ids, and the error taxonomy.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { AuthProvider } from "@/components/auth-provider";
import type { MatchingResponse } from "@/types/matching";
import type { TitleSummary } from "@/lib/movie-sessions";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, prefetch: vi.fn() }),
}));

import ResultsPage from "@/app/results/[sessionId]/page";

const ALICE = { userId: "u1", email: "alice@example.com", name: "Alice Chen", avatarUrl: null };

const RESPONSE: MatchingResponse = {
  tasteMap: {
    members: [
      {
        userId: "u1",
        name: "Alice Chen",
        summary: "Alice reaches for precise, unsettling films.",
        primaryVibes: ["Cerebral"],
        genreAffinities: ["Sci-Fi"],
      },
      {
        userId: "u2",
        name: "Bob Reyes",
        summary: "Bob wants warmth and momentum.",
        primaryVibes: ["Cozy"],
        genreAffinities: ["Comedy"],
      },
    ],
    overlap: {
      summary: "You both light up for smart films with a heart.",
      sharedVibes: ["Witty"],
      tensionPoints: ["Alice sits with ambiguity longer than Bob wants to."],
    },
  },
  recommendations: [
    { tmdbId: 27205, matchScore: 92, explanation: "A heist film with a grief-shaped hole." },
    { tmdbId: 155, matchScore: 84, explanation: "Momentum for Bob, moral murk for Alice." },
  ],
  conversational: "Tonight leans warm.\n**Inception** is the argument you'll both enjoy.",
};

const TITLES: Record<number, TitleSummary> = {
  27205: {
    title: "Inception",
    year: 2010,
    posterPath: "/i.jpg",
    genres: ["Sci-Fi"],
    streaming: { flatrate: ["Netflix"] },
    lastRefreshedAt: new Date().toISOString(),
  },
  155: {
    title: "The Dark Knight",
    year: 2008,
    posterPath: null,
    genres: ["Action"],
    streaming: {},
    lastRefreshedAt: null,
  },
};

const SESSION = {
  id: "s1",
  groupId: "g1",
  moodVibes: ["Cozy"],
  moodText: "",
  discoverNew: false,
  isQuickMatch: true,
  solo: false,
  createdAt: "2026-07-19T20:00:00.000Z",
  roughDay: false,
};

interface StubOptions {
  get?: { status: number; body: unknown };
  match?: { status: number; body: unknown } | (() => { status: number; body: unknown });
}

function stubApi(options: StubOptions = {}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });

      if (url === "/api/auth/me") return new Response(JSON.stringify(ALICE), { status: 200 });
      if (url.endsWith("/match")) {
        const m =
          typeof options.match === "function"
            ? options.match()
            : (options.match ?? {
                status: 200,
                body: { round: 2, response: RESPONSE, titles: TITLES },
              });
        return new Response(JSON.stringify(m.body), { status: m.status });
      }
      if (url.startsWith("/api/movie-sessions/")) {
        const g =
          options.get ?? {
            status: 200,
            body: { session: SESSION, round: 1, response: RESPONSE, titles: TITLES },
          };
        return new Response(JSON.stringify(g.body), { status: g.status });
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

async function renderResults() {
  await act(async () => {
    render(
      <AuthProvider>
        <ResultsPage params={Promise.resolve({ sessionId: "s1" })} />
      </AuthProvider>
    );
  });
}

interface ApiCall {
  url: string;
  method: string;
  body: unknown;
}

const matchCalls = (calls: ApiCall[]) =>
  calls.filter((c) => c.method === "POST" && c.url.endsWith("/match"));

/** The refinement payload, typed so assertions read as the route's contract. */
const matchBody = (call: ApiCall) =>
  call.body as { keptTmdbIds: number[]; removedTmdbIds: number[]; steeringFeedback: string };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("results page", () => {
  it("reads the persisted round and never re-runs the match on mount", async () => {
    const calls = stubApi();
    await renderResults();

    expect(await screen.findByRole("tab", { name: /taste map/i })).toBeTruthy();
    expect(screen.getByText("You both light up for smart films with a heart.")).toBeTruthy();
    // Round 1 is already persisted. Re-POSTing would burn a round of the budget.
    expect(matchCalls(calls)).toHaveLength(0);
    expect(calls.filter((c) => c.url === "/api/movie-sessions/s1")).toHaveLength(1);
  });

  it("opens on the taste map and moves between views with the arrow keys", async () => {
    stubApi();
    await renderResults();

    const map = await screen.findByRole("tab", { name: /taste map/i });
    const picks = screen.getByRole("tab", { name: /picks/i });
    const words = screen.getByRole("tab", { name: /words/i });

    expect(map.getAttribute("aria-selected")).toBe("true");
    expect(map.getAttribute("tabindex")).toBe("0");
    expect(picks.getAttribute("tabindex")).toBe("-1");

    fireEvent.keyDown(map, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /picks/i }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByAltText("Inception poster")).toBeTruthy();

    fireEvent.keyDown(picks, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /words/i }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Tonight leans warm.")).toBeTruthy();

    // Wraps around, and Home returns to the first view.
    fireEvent.keyDown(words, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /taste map/i }).getAttribute("aria-selected")).toBe(
      "true"
    );
    fireEvent.keyDown(screen.getByRole("tab", { name: /taste map/i }), { key: "End" });
    expect(screen.getByRole("tab", { name: /words/i }).getAttribute("aria-selected")).toBe("true");
  });

  it("switches views on click too, and labels the panel with its tab", async () => {
    stubApi();
    await renderResults();

    fireEvent.click(await screen.findByRole("tab", { name: /picks/i }));
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(
      screen.getByRole("tab", { name: /picks/i }).id
    );
    expect(within(panel).getByText("Inception")).toBeTruthy();
  });

  it("sends kept and removed ids plus the steering note, then shows the new round", async () => {
    vi.useFakeTimers();
    const calls = stubApi();
    await renderResults();

    fireEvent.click(screen.getByRole("tab", { name: /picks/i }));
    fireEvent.click(screen.getByRole("button", { name: "Keep Inception" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove The Dark Knight" }));
    fireEvent.change(screen.getByRole("textbox", { name: /anything else/i }), {
      target: { value: "  something lighter  " },
    });

    expect(screen.getByTestId("regenerate").textContent).toBe(
      "Regenerate with ratings + feedback →"
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("regenerate"));
    });

    const posted = matchCalls(calls);
    expect(posted).toHaveLength(1);
    expect(matchBody(posted[0])).toEqual({
      keptTmdbIds: [27205],
      removedTmdbIds: [155],
      steeringFeedback: "something lighter",
    });

    // The calm narrative plays before the new round lands.
    expect(screen.getByText(/reading your tastes/i)).toBeTruthy();
    await settleNarrative();
    expect(screen.getByText("Round 2 of 10")).toBeTruthy();
    // Ratings and the note are spent — the next round starts from a clean slate.
    expect(
      (screen.getByRole("textbox", { name: /anything else/i }) as HTMLTextAreaElement).value
    ).toBe("");
    expect(screen.getByTestId("regenerate").textContent).toBe("Show me different options →");
  });

  it("keeps excluding picks removed in earlier rounds", async () => {
    vi.useFakeTimers();
    let round = 1;
    const calls = stubApi({
      match: () => ({
        status: 200,
        body: { round: ++round, response: RESPONSE, titles: TITLES },
      }),
    });
    await renderResults();

    fireEvent.click(screen.getByRole("tab", { name: /picks/i }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Inception" }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("regenerate"));
    });
    await settleNarrative();

    expect(screen.getByText("+ 1 from earlier rounds")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /picks/i }));
    fireEvent.click(screen.getByRole("button", { name: "Remove The Dark Knight" }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("regenerate"));
    });
    await settleNarrative();

    const posted = matchCalls(calls);
    expect(posted).toHaveLength(2);
    expect(matchBody(posted[1]).removedTmdbIds).toEqual([27205, 155]);
  });

  it("never sends more removed ids than the route will accept", async () => {
    vi.useFakeTimers();
    const many = Array.from({ length: 60 }, (_, i) => ({
      tmdbId: 1000 + i,
      matchScore: 70,
      explanation: "x",
    }));
    const manyTitles = Object.fromEntries(
      many.map((rec) => [
        rec.tmdbId,
        {
          title: `Film ${rec.tmdbId}`,
          year: 2000,
          posterPath: null,
          genres: [],
          streaming: {},
          lastRefreshedAt: null,
        },
      ])
    );
    const calls = stubApi({
      get: {
        status: 200,
        body: {
          session: SESSION,
          round: 1,
          response: { ...RESPONSE, recommendations: many },
          titles: manyTitles,
        },
      },
    });
    await renderResults();

    fireEvent.click(screen.getByRole("tab", { name: /picks/i }));
    for (const rec of many) {
      fireEvent.click(screen.getByRole("button", { name: `Remove Film ${rec.tmdbId}` }));
    }
    await act(async () => {
      fireEvent.click(screen.getByTestId("regenerate"));
    });

    const body = matchBody(matchCalls(calls)[0]);
    expect(body.removedTmdbIds).toHaveLength(50);
    // The 50 most recent survive — the oldest exclusions are the ones to drop.
    expect(body.removedTmdbIds[49]).toBe(1059);
  });

  it("keeps the current picks on screen when a refinement round fails", async () => {
    vi.useFakeTimers();
    stubApi({
      match: {
        status: 503,
        body: { error: "Our movie brain is taking a nap — try again in a moment", kind: "timeout" },
      },
    });
    await renderResults();

    await act(async () => {
      fireEvent.click(screen.getByTestId("regenerate"));
    });
    await settleNarrative();

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Our movie brain is taking a nap");
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    // Round 1 is still good — a failed refinement must not throw it away.
    expect(screen.getByRole("tab", { name: /taste map/i })).toBeTruthy();
    expect(screen.getByText("Round 1 of 10")).toBeTruthy();
  });

  it("offers a way out of a thin brief instead of a retry button", async () => {
    vi.useFakeTimers();
    stubApi({
      match: {
        status: 502,
        body: {
          error: "That was a tough brief — try loosening a dealbreaker",
          kind: "thin_results",
        },
      },
    });
    await renderResults();

    await act(async () => {
      fireEvent.click(screen.getByTestId("regenerate"));
    });
    await settleNarrative();

    expect(screen.getByText(/loosen a dealbreaker\?/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /dealbreakers/i }).getAttribute("href")).toBe(
      "/profile"
    );
    // Retrying the same impossible brief just fails again — the way out is to change it.
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });

  it("stops offering refinement once the round budget is spent", async () => {
    vi.useFakeTimers();
    stubApi({
      match: {
        status: 429,
        body: { error: "You've hit tonight's refinement limit", kind: "round_limit" },
      },
    });
    await renderResults();

    await act(async () => {
      fireEvent.click(screen.getByTestId("regenerate"));
    });
    await settleNarrative();

    expect(screen.getByRole("alert").textContent).toContain("refinement limit");
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
    expect(screen.getByTestId("regenerate").hasAttribute("disabled")).toBe(true);
  });

  it("moves focus to a failed round so a keyboard user is not stranded", async () => {
    vi.useFakeTimers();
    stubApi({
      match: { status: 429, body: { error: "Too many requests", kind: "rate_limited" } },
    });
    await renderResults();

    await act(async () => {
      fireEvent.click(screen.getByTestId("regenerate"));
    });
    await settleNarrative();

    expect(document.activeElement).toBe(screen.getByTestId("refine-error-heading"));
  });

  it("explains a session it cannot load, without pretending to have picks", async () => {
    stubApi({ get: { status: 404, body: { error: "Session not found" } } });
    await renderResults();

    expect(await screen.findByRole("heading", { name: /can't find tonight/i })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("asks before matching a session that has no round yet", async () => {
    const calls = stubApi({
      get: { status: 200, body: { session: SESSION, round: 0, response: null, titles: {} } },
    });
    await renderResults();

    const cta = await screen.findByRole("button", { name: /find our match/i });
    expect(matchCalls(calls)).toHaveLength(0);
    expect(screen.queryByRole("tablist")).toBeNull();

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(cta);
    });
    expect(matchCalls(calls)).toHaveLength(1);
  });

  it("mentions weighting only to the person who asked for it", async () => {
    stubApi({
      get: {
        status: 200,
        body: { session: { ...SESSION, roughDay: true }, round: 1, response: RESPONSE, titles: TITLES },
      },
    });
    await renderResults();

    await screen.findByRole("tab", { name: /taste map/i });
    const note = screen.getByTestId("weighting-note");
    expect(note.textContent).not.toMatch(/rough day/i);
    expect(note.textContent).not.toContain("Bob Reyes");
  });

  it("says nothing about weighting on a solo night, flag or not", async () => {
    stubApi({
      get: {
        status: 200,
        body: {
          session: { ...SESSION, solo: true, roughDay: true },
          round: 1,
          response: { ...RESPONSE, tasteMap: { ...RESPONSE.tasteMap, members: [RESPONSE.tasteMap.members[0]] } },
          titles: TITLES,
        },
      },
    });
    await renderResults();

    await screen.findByRole("tab", { name: /taste map/i });
    expect(screen.queryByTestId("weighting-note")).toBeNull();
  });

  it("hands the evening back to the hub on start over", async () => {
    stubApi();
    await renderResults();

    fireEvent.click(await screen.findByRole("button", { name: /start over/i }));
    expect(push).toHaveBeenCalledWith("/tonight");
  });

  it("renders hostile AI output as literal characters across every view", async () => {
    const hostile: MatchingResponse = {
      tasteMap: {
        members: [
          {
            userId: "u1",
            name: "<script>alert(1)</script>",
            summary: '<img src=x onerror="alert(2)"> &amp; more',
            primaryVibes: [],
            genreAffinities: [],
          },
        ],
        overlap: { summary: "<iframe></iframe>", sharedVibes: [], tensionPoints: [] },
      },
      recommendations: [
        { tmdbId: 27205, matchScore: 50, explanation: "<b>not bold</b>" },
      ],
      conversational: "<svg onload=alert(3)>",
    };
    stubApi({
      get: { status: 200, body: { session: SESSION, round: 1, response: hostile, titles: {} } },
    });
    const container = document.body;
    await renderResults();

    await screen.findByRole("tab", { name: /taste map/i });
    expect(screen.getByText('<img src=x onerror="alert(2)"> &amp; more')).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /picks/i }));
    expect(screen.getByText("<b>not bold</b>")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /words/i }));
    expect(screen.getByText("<svg onload=alert(3)>")).toBeTruthy();

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("svg[onload]")).toBeNull();
  });

  it("sends a signed-out visitor home rather than showing an empty shell", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }))
    );
    await renderResults();
    expect(replace).toHaveBeenCalledWith("/");
  });
});
