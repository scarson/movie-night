// ABOUTME: Site footer — TMDB + JustWatch attribution (required by their terms) and privacy link.
// ABOUTME: Quiet ash text on midnight; sits below the 680px content column on every page.
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-[680px] px-md pb-xl pt-2xl">
      <div className="border-t border-slate pt-lg text-sm text-ash">
        <p>
          This product uses the TMDB API but is not endorsed or certified by
          TMDB.
        </p>
        <p className="mt-xs">Streaming data by JustWatch</p>
        <p className="mt-md">
          <Link
            href="/privacy"
            className="inline-flex min-h-11 items-center text-amber underline-offset-4 hover:underline"
          >
            Privacy
          </Link>
        </p>
      </div>
    </footer>
  );
}
