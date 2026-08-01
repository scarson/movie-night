// ABOUTME: Asserts an element declares no text-clipping utility, for the 1.4.10
// ABOUTME: guards — jsdom has no layout, so the class list is all there is to check.

/**
 * Every Tailwind utility that can hide overflowing text without offering a way
 * to reveal it. `truncate` is the shorthand; the other four are the pieces it
 * expands to, plus the clamps, any of which reintroduces the same information
 * loss under a different spelling.
 */
const CLIPPING_UTILITIES = [
  /^truncate$/,
  /^text-ellipsis$/,
  /^overflow-hidden$/,
  /^whitespace-nowrap$/,
  /^line-clamp-\d+$/,
];

/**
 * The clipping utilities an element declares. Empty means the text can reflow
 * to as many lines as it needs.
 *
 * This is a denylist over class names because jsdom has no layout engine and no
 * CSS cascade: `scrollWidth` and `clientWidth` read 0 for every element, so the
 * geometric check this stands in for is only possible in a real browser. See
 * dev/reports/2026-08-01-authenticated-a11y-verification.md §Part 1.
 */
export function clippingUtilities(element: Element): string[] {
  return element.className
    .split(/\s+/)
    .filter((name) => CLIPPING_UTILITIES.some((pattern) => pattern.test(name)));
}
