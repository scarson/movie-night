// ABOUTME: TMDB poster image in a fixed 2:3 box — a plain <img> (next/image is unavailable on
// ABOUTME: Workers) with a width ladder, lazy unless prioritised, charcoal fallback when no path.

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/";

/**
 * TMDB's poster variants, up to the largest worth serving here. The widest box
 * in the app is 14rem, so w780 would only ever be picked by a phone at DPR 3 —
 * 163 KB for a 224px box, against 87 KB at w500 for 2.2x density.
 */
const CANDIDATE_WIDTHS = [92, 154, 185, 342, 500];

/** The picks-list column: `sm:grid-cols-[13rem_1fr]` over `minmax(0,14rem)`. */
const PICKS_LIST_SIZES = "(min-width: 40rem) 13rem, 14rem";

export interface PosterProps {
  title: string;
  posterPath: string | null;
  size?: "w92" | "w185" | "w342";
  className?: string;
  /**
   * The rendered width of the box, for candidate selection — a `sizes`
   * attribute, so media conditions are allowed. Defaults to the picks-list
   * column; any caller whose box is a different width MUST pass its own, or
   * the browser will confidently fetch a variant sized for a poster.
   */
  sizes?: string;
  /**
   * Fetch eagerly at high priority rather than lazily. For the one image in a
   * list that matters most: it is not queued behind its siblings and does not
   * wait for layout to confirm it is in the viewport.
   */
  priority?: boolean;
}

export function Poster({
  title,
  posterPath,
  size = "w342",
  className = "",
  sizes = PICKS_LIST_SIZES,
  priority = false,
}: PosterProps) {
  const frame = `aspect-[2/3] overflow-hidden rounded-tag bg-charcoal ${className}`;
  if (!posterPath) {
    return (
      <div role="img" aria-label={`${title} poster`} className={frame}>
        <div className="flex h-full items-center justify-center font-display text-xl italic text-ash">
          {title.charAt(0)}
        </div>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- no image optimization on Workers (plan Task 7.1)
    <img
      src={`${TMDB_IMAGE_BASE}${size}${posterPath}`}
      srcSet={CANDIDATE_WIDTHS.map(
        (width) => `${TMDB_IMAGE_BASE}w${width}${posterPath} ${width}w`
      ).join(", ")}
      sizes={sizes}
      alt={`${title} poster`}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className={`${frame} object-cover`}
    />
  );
}
