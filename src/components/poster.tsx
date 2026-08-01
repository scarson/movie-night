// ABOUTME: TMDB poster image in a fixed 2:3 box — a plain <img> (next/image is unavailable
// ABOUTME: on Workers), lazy unless prioritised, with a quiet charcoal fallback when no path exists.

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/";

export interface PosterProps {
  title: string;
  posterPath: string | null;
  size?: "w92" | "w185" | "w342";
  className?: string;
  /** The first poster on a screen is the LCP element; lazily loading it costs a round trip. */
  priority?: boolean;
}

export function Poster({
  title,
  posterPath,
  size = "w342",
  className = "",
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
      alt={`${title} poster`}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className={`${frame} object-cover`}
    />
  );
}
