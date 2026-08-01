// ABOUTME: Reports which text-clipping Tailwind utilities an element declares,
// ABOUTME: backing the 1.4.10 guards — jsdom has no layout, so classes are all there is.

/**
 * Utilities that hide overflowing text or stop it wrapping. `truncate` is the
 * shorthand; the rest are the pieces it expands to, their axis and `clip`
 * variants, the `nowrap` spellings, and the clamps — any of which reintroduces
 * the same information loss under a different name.
 */
const CLIPPING_UTILITIES = [
  /^truncate$/,
  /^text-ellipsis$/,
  // Any axis, and `clip` as well as `hidden` — either hides the overflow.
  /^overflow(-[xy])?-(hidden|clip)$/,
  // `pre` suppresses wrapping just as `nowrap` does, and `text-nowrap` is the
  // same declaration under a second name. `pre-wrap` and `pre-line` both still
  // wrap, so they are not listed.
  /^(whitespace-(nowrap|pre)|text-nowrap)$/,
  /^line-clamp-\d+$/,
];

/**
 * The clipping utilities this element declares. Empty means its own text can
 * reflow to as many lines as it needs.
 *
 * This is a denylist over class names because jsdom has no layout engine and no
 * CSS cascade: `scrollWidth` and `clientWidth` read 0 for every element, so the
 * geometric check it stands in for is only possible in a real browser. See
 * dev/reports/2026-08-01-authenticated-a11y-verification.md §Part 1.
 *
 * **It inspects this element only.** An ancestor can still clip the subtree, and
 * no class-level check can tell a legitimate `overflow-hidden` container from a
 * clipping one. Guarding an ancestor is a browser measurement, not this.
 */
export function clippingUtilities(element: Element): string[] {
  return Array.from(element.classList).filter((name) =>
    CLIPPING_UTILITIES.some((pattern) => pattern.test(name))
  );
}
