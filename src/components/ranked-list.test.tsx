// @vitest-environment jsdom
// ABOUTME: Tests for the ranked list — poster-dominant items, the keep/remove state
// ABOUTME: machine, score announcement, streaming badges with staleness, literal AI text.
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { RankedList, type Rating } from "@/components/ranked-list";
import type { Recommendation } from "@/types/matching";
import type { TitleSummary } from "@/lib/movie-sessions";

const NOW = new Date("2026-07-19T21:00:00.000Z");
const FRESH = new Date("2026-07-15T00:00:00.000Z").toISOString();
const STALE = new Date("2026-07-04T00:00:00.000Z").toISOString();

const RECS: Recommendation[] = [
  { tmdbId: 27205, matchScore: 92, explanation: "A heist film with a grief-shaped hole in it." },
  { tmdbId: 155, matchScore: 84, explanation: "Momentum for Bob, moral murk for Alice." },
];

const TITLES: Record<number, TitleSummary> = {
  27205: {
    title: "Inception",
    year: 2010,
    posterPath: "/inception.jpg",
    genres: ["Sci-Fi", "Thriller"],
    streaming: { flatrate: ["Netflix"], rent: ["Apple TV"] },
    lastRefreshedAt: FRESH,
  },
  155: {
    title: "The Dark Knight",
    year: 2008,
    posterPath: null,
    genres: ["Action"],
    streaming: { rent: ["Prime Video"] },
    lastRefreshedAt: STALE,
  },
};

function Harness({
  recommendations = RECS,
  titles = TITLES,
  initial = {},
}: {
  recommendations?: Recommendation[];
  titles?: Record<number, TitleSummary>;
  initial?: Record<number, Rating>;
}) {
  const [ratings, setRatings] = useState<Record<number, Rating>>(initial);
  return (
    <RankedList
      recommendations={recommendations}
      titles={titles}
      ratings={ratings}
      onRatingsChange={setRatings}
      now={NOW}
    />
  );
}

const keepButton = (title: string) => screen.getByRole("button", { name: `Keep ${title}` });
const removeButton = (title: string) => screen.getByRole("button", { name: `Remove ${title}` });

describe("RankedList", () => {
  it("renders each pick poster-first with its rank, title, year and explanation", () => {
    render(<Harness />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);

    const first = within(items[0]);
    expect(first.getByAltText("Inception poster")).toBeTruthy();
    expect(first.getByText("Inception")).toBeTruthy();
    expect(first.getByText(/2010/)).toBeTruthy();
    expect(first.getByText(RECS[0].explanation)).toBeTruthy();

    // The ranking is real information, so it is carried by an ordered list —
    // the visible numeral is decoration on top of that, not the only signal.
    expect(items[0].closest("ol")).not.toBeNull();

    // Rank numerals are Fraunces per DESIGN.md, and count from 1 in list order.
    const ranks = screen.getAllByTestId("rank-numeral");
    expect(ranks.map((el) => el.textContent)).toEqual(["1", "2"]);
    for (const rank of ranks) expect(rank.className).toContain("font-display");
  });

  it("announces the score as a percentage and renders it with tabular numerals", () => {
    render(<Harness />);
    expect(screen.getByText("Inception, 92% match")).toBeTruthy();
    const badge = screen.getAllByTestId("score-badge")[0];
    expect(badge.className).toContain("tabular-nums");
    expect(badge.textContent).toContain("92");
  });

  it("toggles keep on, then off again on a second tap", () => {
    render(<Harness />);
    const keep = keepButton("Inception");
    expect(keep.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(keep);
    expect(keepButton("Inception").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(keepButton("Inception"));
    expect(keepButton("Inception").getAttribute("aria-pressed")).toBe("false");
  });

  it("switches a kept pick straight to removed, and back off on a re-tap", () => {
    render(<Harness />);
    fireEvent.click(keepButton("Inception"));
    fireEvent.click(removeButton("Inception"));

    expect(keepButton("Inception").getAttribute("aria-pressed")).toBe("false");
    expect(removeButton("Inception").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(removeButton("Inception"));
    expect(removeButton("Inception").getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps each pick's rating independent of the others", () => {
    render(<Harness />);
    fireEvent.click(keepButton("Inception"));
    expect(keepButton("The Dark Knight").getAttribute("aria-pressed")).toBe("false");
    expect(removeButton("The Dark Knight").getAttribute("aria-pressed")).toBe("false");
  });

  it("reports the state of each pick to assistive tech, not just by colour", () => {
    render(<Harness initial={{ 27205: "kept", 155: "removed" }} />);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText(/kept for the next round/i)).toBeTruthy();
    expect(within(items[1]).getByText(/won't come back/i)).toBeTruthy();
  });

  it("labels subscription streaming plainly and rentals as rentals", () => {
    render(<Harness />);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("On Netflix")).toBeTruthy();
    expect(within(items[1]).getByText("Rent on Prime Video")).toBeTruthy();
  });

  it("dates streaming info only once it is more than 14 days old", () => {
    render(<Harness />);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).queryByText(/as of/i)).toBeNull();
    expect(within(items[1]).getByText("as of 4 Jul 2026")).toBeTruthy();
  });

  it("says nothing about streaming when the catalog knows of none", () => {
    const titles = {
      ...TITLES,
      27205: { ...TITLES[27205], streaming: {}, lastRefreshedAt: STALE },
    };
    render(<Harness titles={titles} />);
    const first = within(screen.getAllByRole("listitem")[0]);
    expect(first.queryByText(/^on |^rent on |as of/i)).toBeNull();
  });

  it("still renders a pick whose title never hydrated from the catalog", () => {
    render(<Harness titles={{}} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText(RECS[0].explanation)).toBeTruthy();
    // The controls must stay operable and uniquely named without a title.
    expect(screen.getAllByRole("button", { name: /^Keep / })).toHaveLength(2);
  });

  it("renders AI-authored explanations and titles as literal characters", () => {
    const hostile: Recommendation[] = [
      { tmdbId: 1, matchScore: 70, explanation: '<img src=x onerror="alert(1)"> &amp; more' },
    ];
    const titles: Record<number, TitleSummary> = {
      1: {
        title: "<script>alert(2)</script>",
        year: null,
        posterPath: null,
        genres: [],
        streaming: {},
        lastRefreshedAt: null,
      },
    };
    const { container } = render(<Harness recommendations={hostile} titles={titles} />);

    expect(screen.getByText('<img src=x onerror="alert(1)"> &amp; more')).toBeTruthy();
    expect(screen.getByText("<script>alert(2)</script>")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("lets an unbreakable title or explanation break rather than widen the page", () => {
    // Titles come from the catalog and explanations from the model; a single
    // long token used to push the item box to ~846px inside a 343px column.
    render(<Harness />);
    const item = screen.getAllByRole("listitem")[0];
    const title = within(item).getByText("Inception");
    const explanation = within(item).getByText(RECS[0].explanation);
    expect(title.className).toContain("break-words");
    expect(explanation.className).toContain("break-words");
  });

  it("staggers item entrances at 80ms per DESIGN.md motion", () => {
    render(<Harness />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((el) => (el as HTMLElement).style.animationDelay)).toEqual(["0ms", "80ms"]);
    for (const item of items) expect(item.className).toContain("animate-rise-fade");
  });

  it("prioritises the first pick's poster and only the first", () => {
    // Pick #1 is the results page's LCP element. A second eager poster would
    // compete for bandwidth with the one being sped up, so this asserts *which*
    // image is eager, not merely that one of them is.
    const five: Recommendation[] = [1, 2, 3, 4, 5].map((n) => ({
      tmdbId: n,
      matchScore: 100 - n,
      explanation: `Pick ${n}`,
    }));
    const fiveTitles: Record<number, TitleSummary> = Object.fromEntries(
      five.map(({ tmdbId }) => [
        tmdbId,
        {
          title: `Film ${tmdbId}`,
          year: 2020,
          posterPath: `/film-${tmdbId}.jpg`,
          genres: ["Drama"],
          streaming: {},
          lastRefreshedAt: FRESH,
        },
      ])
    );
    const { container } = render(
      <Harness recommendations={five} titles={fiveTitles} />
    );

    const posters = Array.from(container.querySelectorAll("img"));
    expect(posters).toHaveLength(5);
    expect(posters.map((img) => img.getAttribute("loading"))).toEqual([
      "eager",
      "lazy",
      "lazy",
      "lazy",
      "lazy",
    ]);
    expect(posters[0].getAttribute("alt")).toBe("Film 1 poster");
    expect(posters[0].getAttribute("fetchpriority")).toBe("high");
  });

  it("does not re-render the world when a rating changes", () => {
    const onRatingsChange = vi.fn();
    render(
      <RankedList
        recommendations={RECS}
        titles={TITLES}
        ratings={{}}
        onRatingsChange={onRatingsChange}
        now={NOW}
      />
    );
    fireEvent.click(keepButton("Inception"));
    expect(onRatingsChange).toHaveBeenCalledTimes(1);
    expect(onRatingsChange).toHaveBeenCalledWith({ 27205: "kept" });
  });
});
