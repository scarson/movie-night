// ABOUTME: Tests for saveProfile — how a partially-enriched save is phrased back
// ABOUTME: to the user, and how a refused save still comes through as an error.

import { describe, it, expect, afterEach, vi } from "vitest";
import { saveProfile } from "@/lib/session-flow";
import type { ProfileDraft } from "@/components/profile-editor";
import type { TitleRef } from "@/components/title-search";

function title(tmdbId: number, name: string): TitleRef {
  return { tmdbId, title: name, year: null, posterPath: null };
}

function draftOf(comfortTitles: TitleRef[], watchlist: TitleRef[] = []): ProfileDraft {
  return { comfortTitles, watchlist, vibes: [], dealbreakers: [], streamingServices: [] };
}

function stubPut(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveProfile", () => {
  it("says nothing extra when the whole edit landed", async () => {
    stubPut({ profile: {} });
    const result = await saveProfile(draftOf([title(1, "Arrival")]));
    expect(result).toEqual({ error: null, notice: null });
  });

  it("names a deleted title and points at the only remedy it has", async () => {
    stubPut({ profile: {}, skippedTitles: [{ tmdbId: 1, reason: "not-found" }] });
    const result = await saveProfile(draftOf([title(1, "Arrival")]));
    expect(result.error).toBeNull();
    expect(result.notice).toBe(
      "Saved. Arrival isn't in TMDB anymore, so it wasn't added — pick something else instead."
    );
  });

  it("tells the user to come back later when TMDB was merely unreachable", async () => {
    stubPut({ profile: {}, skippedTitles: [{ tmdbId: 2, reason: "unavailable" }] });
    const result = await saveProfile(draftOf([], [title(2, "Heat")]));
    expect(result.notice).toBe(
      "Saved. We couldn't reach TMDB for Heat, so it wasn't added — try again in a little while."
    );
  });

  it("keeps the two reasons apart when a save hits both", async () => {
    stubPut({
      profile: {},
      skippedTitles: [
        { tmdbId: 1, reason: "not-found" },
        { tmdbId: 2, reason: "unavailable" },
      ],
    });
    const result = await saveProfile(draftOf([title(1, "Arrival"), title(2, "Heat")]));
    expect(result.notice).toBe(
      "Saved. Arrival isn't in TMDB anymore, so it wasn't added — pick something else instead. " +
        "We couldn't reach TMDB for Heat, so it wasn't added — try again in a little while."
    );
  });

  it("names the first three skipped titles and counts the rest", async () => {
    // Names are deliberately not in alphabetical order: the three that survive
    // are the three the server reported first, which is the order the user's
    // own lists referenced them in — not whichever three sort earliest.
    const titles = [
      title(1, "Whiplash"),
      title(2, "Amelie"),
      title(3, "Moonlight"),
      title(4, "Brazil"),
      title(5, "Solaris"),
    ];
    stubPut({
      profile: {},
      skippedTitles: titles.map((t) => ({ tmdbId: t.tmdbId, reason: "not-found" })),
    });
    const result = await saveProfile(draftOf(titles));
    expect(result.notice).toBe(
      "Saved. Whiplash, Amelie, Moonlight and 2 more aren't in TMDB anymore, so they weren't added — pick something else instead."
    );
  });

  it("passes a refused save through as an error with nothing to add", async () => {
    stubPut({ error: "Failed to save profile" }, 500);
    const result = await saveProfile(draftOf([title(1, "Arrival")]));
    expect(result).toEqual({ error: "Failed to save profile", notice: null });
  });
});
