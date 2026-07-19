// ABOUTME: Guards the reduced-motion rules in globals.css — they must disable
// ABOUTME: animations outright, not shorten them, or animated content stays invisible.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(
  path.resolve(__dirname, "globals.css"),
  "utf8"
);

/** Returns the declaration body of the rule whose selector list contains `marker`. */
function ruleBody(marker: string): string {
  const start = css.indexOf(marker);
  expect(start, `no rule containing ${marker}`).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("globals.css reduced-motion rules", () => {
  // Both entry points into reduced motion: the OS setting and the in-app toggle.
  const blocks: [string, string][] = [
    ["prefers-reduced-motion media query", "@media (prefers-reduced-motion: reduce)"],
    ["in-app data-reduced-motion toggle", '[data-reduced-motion="true"] *,'],
  ];

  for (const [label, marker] of blocks) {
    describe(label, () => {
      it("switches animations off rather than shortening them", () => {
        // A near-zero `animation-duration` does NOT fast-forward the animation:
        // Chrome pins it at currentTime 0, and with `animation-fill-mode: both`
        // the element is stuck on the `from` keyframe — opacity 0. Every element
        // using --animate-rise-fade would render invisible. Verified in-browser.
        const body =
          marker.startsWith("@media")
            ? css.slice(css.indexOf(marker), css.indexOf('[data-reduced-motion="true"]'))
            : ruleBody(marker);
        expect(body).toMatch(/animation:\s*none\s*!important/);
        expect(body).not.toMatch(/animation-duration\s*:/);
      });
    });
  }

  it("keeps the rise-fade keyframes ending fully visible", () => {
    const keyframes = css.slice(css.indexOf("@keyframes rise-fade"));
    const to = keyframes.slice(keyframes.indexOf("to {"));
    expect(to).toMatch(/opacity:\s*1/);
    expect(to).toMatch(/transform:\s*none/);
  });
});
