// ABOUTME: WCAG relative-luminance contrast maths plus the palette read live from
// ABOUTME: globals.css, so contrast assertions track the real tokens instead of a copy.
import { readFileSync } from "node:fs";
import path from "node:path";

/** Parses `--name: #hex;` declarations out of the `:root` block in globals.css. */
function readTokens(): Record<string, string> {
  const css = readFileSync(
    path.resolve(__dirname, "..", "app", "globals.css"),
    "utf8"
  );
  const root = css.slice(css.indexOf(":root {"), css.indexOf("@theme inline"));
  const tokens: Record<string, string> = {};
  for (const [, name, hex] of root.matchAll(
    /--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g
  )) {
    tokens[name] = hex;
  }
  return tokens;
}

/**
 * The palette as declared in globals.css, keyed by token name without the
 * leading dashes (`midnight`, `ash`, `person-a`, …).
 */
export const TOKENS: Record<string, string> = readTokens();

/** Expands `#abc` to `#aabbcc` and drops any alpha channel. */
function normalizeHex(hex: string): string {
  const body = hex.replace("#", "");
  const expanded =
    body.length === 3 || body.length === 4
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  return expanded.slice(0, 6);
}

/** Relative luminance per WCAG 2.x §relative luminance. */
export function relativeLuminance(hex: string): number {
  const body = normalizeHex(hex);
  const channels = [0, 2, 4].map((i) => {
    const srgb = parseInt(body.slice(i, i + 2), 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast ratio between two colors, in the range 1–21. Order-independent.
 * Alpha is ignored: composite the color against its backdrop before calling.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}
