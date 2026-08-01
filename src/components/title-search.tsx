// ABOUTME: Catalog title picker — debounced /api/titles/search lookup with poster
// ABOUTME: results, selected titles as removable chips, and optional quick picks.
"use client";

import { useEffect, useRef, useState } from "react";
import { Chip } from "@/components/chip";
import { Poster } from "@/components/poster";

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;
/** Matches the server's per-list ceiling for a title list. */
const MAX_TITLES = 50;

export interface TitleRef {
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
}

export interface TitleSearchProps {
  selected: TitleRef[];
  onChange: (titles: TitleRef[]) => void;
  quickPicks?: TitleRef[];
  placeholder?: string;
  /** How many entries the receiving endpoint accepts. */
  max?: number;
}

export function TitleSearch({
  selected,
  onChange,
  quickPicks = [],
  placeholder = "Search for a title…",
  max = MAX_TITLES,
}: TitleSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TitleRef[]>([]);
  const [failed, setFailed] = useState(false);
  const [limitHit, setLimitHit] = useState(false);
  const requestSeq = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return;
    const seq = ++requestSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/titles/search?q=${encodeURIComponent(trimmed)}`
        );
        if (!res.ok) throw new Error(`search failed: ${res.status}`);
        const body = (await res.json()) as { results: TitleRef[] };
        if (seq === requestSeq.current) {
          setResults(body.results);
          setFailed(false);
        }
      } catch {
        if (seq === requestSeq.current) {
          setResults([]);
          setFailed(true);
        }
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const isSelected = (tmdbId: number) =>
    selected.some((t) => t.tmdbId === tmdbId);

  // Clearing results belongs in the event handlers rather than the effect body:
  // a synchronous reset inside an effect cascades an extra render pass. Bumping
  // the sequence discards any response still in flight.
  const clearResults = () => {
    requestSeq.current++;
    setResults([]);
    setFailed(false);
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (value.trim().length < MIN_QUERY_LENGTH) clearResults();
  };

  const add = (title: TitleRef) => {
    if (!isSelected(title.tmdbId)) {
      // A tap that does nothing and says nothing reads as a broken control. The
      // query stays put so the refusal sits beside what it refused.
      if (selected.length >= max) {
        setLimitHit(true);
        return;
      }
      onChange([...selected, title]);
    }
    setQuery("");
    clearResults();
  };

  const remove = (tmdbId: number) => {
    onChange(selected.filter((t) => t.tmdbId !== tmdbId));
    setLimitHit(false);
  };

  const unselectedQuickPicks = quickPicks.filter((t) => !isSelected(t.tmdbId));
  const visibleResults = results.filter((t) => !isSelected(t.tmdbId));

  return (
    <div>
      {(selected.length > 0 || unselectedQuickPicks.length > 0) && (
        <div className="mb-sm flex flex-wrap gap-sm">
          {selected.map((title) => (
            <Chip
              key={title.tmdbId}
              label={title.title}
              selected={true}
              onToggle={() => remove(title.tmdbId)}
              removable
            />
          ))}
          {unselectedQuickPicks.map((title) => (
            <Chip
              key={title.tmdbId}
              label={title.title}
              selected={false}
              onToggle={() => add(title)}
            />
          ))}
        </div>
      )}

      <input
        type="text"
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Search for a title"
        className="min-h-11 w-full rounded-control border border-ash bg-charcoal px-md text-base text-cream placeholder:text-ash"
      />

      {failed && (
        <p className="mt-sm text-sm text-ash">Couldn&apos;t search right now.</p>
      )}

      <p
        aria-live="polite"
        className={`mt-sm text-sm tabular-nums ${limitHit ? "text-ember" : "text-ash"}`}
      >
        {limitHit
          ? `${max} is the limit — remove one first.`
          : selected.length > 0
            ? `${selected.length} of ${max} chosen`
            : ""}
      </p>

      {visibleResults.length > 0 && (
        <ul className="mt-sm overflow-hidden rounded-control border border-slate bg-charcoal">
          {visibleResults.map((title) => (
            <li key={title.tmdbId} className="border-b border-slate last:border-b-0">
              <button
                type="button"
                onClick={() => add(title)}
                aria-label={
                  title.year !== null
                    ? `${title.title} (${title.year})`
                    : title.title
                }
                className="flex min-h-11 w-full items-center gap-md px-md py-sm text-left hover:bg-slate/50"
              >
                {/* Decorative inside the button — the text is the accessible name */}
                <span aria-hidden="true" className="w-8 shrink-0">
                  <Poster
                    title={title.title}
                    posterPath={title.posterPath}
                    size="w92"
                    sizes="2rem"
                  />
                </span>
                <span className="text-base text-cream">
                  {title.title}
                  {title.year !== null && (
                    <span className="text-ash">{` (${title.year})`}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
