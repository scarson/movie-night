// ABOUTME: Keyboard bypass for the repeated nav — invisible until focused, then a
// ABOUTME: normal amber-outlined control pinned to the top-left of the viewport.
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only rounded-control border border-amber bg-midnight px-md py-sm text-base font-medium text-cream focus:not-sr-only focus:absolute focus:left-md focus:top-md focus:z-50 focus:flex focus:min-h-11 focus:items-center"
    >
      Skip to content
    </a>
  );
}
