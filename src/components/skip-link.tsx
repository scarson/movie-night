// ABOUTME: Keyboard bypass for the repeated nav — invisible until focused, then a
// ABOUTME: normal amber-outlined control pinned to the top-left of the viewport.

// Every layout utility is focus-prefixed on purpose: `not-sr-only` resets padding,
// position and sizing, so an unprefixed `px-*` loses the cascade and the focused
// link renders with its text jammed against the border.
const CLASSES =
  "sr-only rounded-control border border-amber bg-midnight text-base font-medium text-cream " +
  "focus:not-sr-only focus:absolute focus:left-md focus:top-md focus:z-50 focus:flex " +
  "focus:min-h-11 focus:items-center focus:px-md focus:py-sm";

export function SkipLink() {
  return (
    <a href="#main" className={CLASSES}>
      Skip to content
    </a>
  );
}
