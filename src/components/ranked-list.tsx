// ABOUTME: Tonight's picks as a magazine spread — large poster, Fraunces rank numeral,
// ABOUTME: a quiet score badge, streaming with a staleness date, and keep/remove controls.
"use client";

import { Poster } from "@/components/poster";
import type { Recommendation } from "@/types/matching";
import type { TitleSummary } from "@/lib/movie-sessions";
import type { StreamingInfo } from "@/lib/tmdb";

export type Rating = "kept" | "removed";

/** DESIGN.md motion: 80ms between items, fade + slight drift, no bounce. */
const STAGGER_MS = 80;

/** Past this, the cron hasn't refreshed availability recently enough to state it flatly. */
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Where you can watch it, in plain words. Subscriptions win — a rental is only
 * mentioned when there is nothing to stream on a plan they may already have.
 */
export function streamingLabels(streaming: StreamingInfo): string[] {
  const flatrate = (streaming.flatrate ?? []).slice(0, 3);
  if (flatrate.length > 0) return flatrate.map((provider) => `On ${provider}`);
  const rent = streaming.rent?.[0];
  if (rent !== undefined) return [`Rent on ${rent}`];
  const buy = streaming.buy?.[0];
  if (buy !== undefined) return [`Buy on ${buy}`];
  return [];
}

/** "as of 4 Jul 2026" once the data is over a fortnight old; null while it's current. */
export function asOfNote(lastRefreshedAt: string | null, now: Date): string | null {
  if (lastRefreshedAt === null) return null;
  const refreshed = Date.parse(lastRefreshedAt);
  if (Number.isNaN(refreshed)) return null;
  if (now.getTime() - refreshed <= STALE_AFTER_MS) return null;
  const date = new Date(refreshed);
  return `as of ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24">
      <path
        d="M12 20.5C7 16.5 3.5 13.1 3.5 9.4 3.5 6.7 5.6 4.5 8.2 4.5c1.5 0 3 .7 3.8 1.9.8-1.2 2.3-1.9 3.8-1.9 2.6 0 4.7 2.2 4.7 4.9 0 3.7-3.5 7.1-8.5 11.1Z"
        fill={filled ? "var(--sage)" : "none"}
        stroke={filled ? "var(--sage)" : "currentColor"}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Cross({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24">
      <path
        d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"
        fill="none"
        stroke={filled ? "var(--ember)" : "currentColor"}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RatingButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`flex size-11 shrink-0 items-center justify-center rounded-pill border text-ash transition-colors duration-100 hover:text-cream ${
        pressed ? "border-cream" : "border-ash"
      }`}
    >
      {children}
    </button>
  );
}

export interface RankedListProps {
  recommendations: Recommendation[];
  /** tmdbId → catalog row, hydrated server-side so nothing here fuzzy-matches. */
  titles: Record<number, TitleSummary>;
  ratings: Record<number, Rating>;
  onRatingsChange: (next: Record<number, Rating>) => void;
  /** Injected so staleness is testable against a fixed clock. */
  now?: Date;
}

export function RankedList({
  recommendations,
  titles,
  ratings,
  onRatingsChange,
  now = new Date(),
}: RankedListProps) {
  // Tapping the rating a pick already has clears it; tapping the other one swaps.
  const rate = (tmdbId: number, tapped: Rating) => {
    const next = { ...ratings };
    if (next[tmdbId] === tapped) {
      delete next[tmdbId];
    } else {
      next[tmdbId] = tapped;
    }
    onRatingsChange(next);
  };

  return (
    <ol className="flex flex-col">
      {recommendations.map((rec, index) => {
        const title = titles[rec.tmdbId];
        // The catalog is the source of names; a pick that never hydrated still
        // gets operable, uniquely-named controls.
        const name = title?.title ?? `pick ${index + 1}`;
        const rating = ratings[rec.tmdbId];
        const removed = rating === "removed";
        const kept = rating === "kept";
        const labels = title ? streamingLabels(title.streaming) : [];
        const asOf = labels.length > 0 && title ? asOfNote(title.lastRefreshedAt, now) : null;
        const meta = [title?.year, title?.genres.join(", ")]
          .filter((part) => part !== null && part !== undefined && part !== "")
          .join(" · ");

        return (
          <li
            key={rec.tmdbId}
            style={{ animationDelay: `${index * STAGGER_MS}ms` }}
            className={`animate-rise-fade grid grid-cols-[minmax(0,14rem)_1fr] gap-x-md gap-y-md border-t border-slate py-2xl first:border-t-0 first:pt-0 sm:grid-cols-[13rem_1fr] sm:gap-x-lg ${
              removed ? "opacity-50" : ""
            }`}
          >
            {/* The poster leads and the type sets around it, magazine-style —
                on a phone it takes most of the measure, with the rank and score
                sitting in the air beside it. */}
            <div className="sm:row-span-2">
              {/* Pick #1 is the LCP element on this screen. Only it is eager:
                  a second eager poster competes for the same bandwidth. */}
              <Poster
                title={name}
                posterPath={title?.posterPath ?? null}
                size="w342"
                priority={index === 0}
              />
            </div>

            <div className="flex flex-col items-start gap-sm">
              <span
                data-testid="rank-numeral"
                aria-hidden="true"
                className="font-display text-[2.5rem]/[1] font-extrabold text-ash/60"
              >
                {index + 1}
              </span>
              <span
                data-testid="score-badge"
                aria-hidden="true"
                className="rounded-pill bg-charcoal px-md py-2xs text-sm tabular-nums text-cream"
              >
                {rec.matchScore}
                <span className="ml-xs text-xs text-ash">match</span>
              </span>
            </div>

            <div className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2">
              <h2
                className={`break-words font-display text-[1.75rem]/[1.15] font-bold text-warm-white ${
                  removed ? "line-through" : ""
                }`}
              >
                {name}
              </h2>
              <span className="sr-only">{`${name}, ${rec.matchScore}% match`}</span>
              {meta !== "" && <p className="mt-2xs break-words text-sm text-ash">{meta}</p>}

              {kept && <p className="mt-sm text-sm text-sage">Kept for the next round</p>}
              {removed && (
                <p className="mt-sm text-sm text-ember">Won&apos;t come back next round</p>
              )}

              <p className="mt-md max-w-[62ch] break-words text-base/[1.6] text-cream">{rec.explanation}</p>

              <div className="mt-lg flex flex-wrap items-center gap-x-md gap-y-sm">
                {labels.map((label, i) => (
                  <span
                    key={i}
                    className="max-w-full break-words rounded-tag border border-slate px-sm py-2xs text-xs text-ash"
                  >
                    {label}
                  </span>
                ))}
                {asOf !== null && <span className="text-xs text-ash">{asOf}</span>}

                <span className="ml-auto flex items-center gap-sm">
                  <RatingButton
                    label={`Keep ${name}`}
                    pressed={kept}
                    onClick={() => rate(rec.tmdbId, "kept")}
                  >
                    <Heart filled={kept} />
                  </RatingButton>
                  <RatingButton
                    label={`Remove ${name}`}
                    pressed={removed}
                    onClick={() => rate(rec.tmdbId, "removed")}
                  >
                    <Cross filled={removed} />
                  </RatingButton>
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
