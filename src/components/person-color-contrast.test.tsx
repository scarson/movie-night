// @vitest-environment jsdom
// ABOUTME: WCAG sweep for the person-a…d / overlap taste-map colors — every surface they
// ABOUTME: actually land on, each pair asserted at the threshold that use's role requires.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { composite, contrastRatio, TOKENS } from "@/test/contrast";
import { TasteMap } from "@/components/taste-map";
import { Chip } from "@/components/chip";
import type { TasteMap as TasteMapData } from "@/types/matching";

/**
 * The only opaque backdrop any person color is painted on. Every surface that
 * uses one — the results page's taste map, the landing vignette, the profile
 * and ritual dealbreaker chips — renders inside a bare `<main>` whose nearest
 * painted ancestor is `body { background-color: var(--midnight) }`. No panel,
 * card or wash sits between them; see the enumeration guard below.
 */
const PAGE = TOKENS.midnight;

/** The selected dealbreaker chip's own fill, flattened over the page. */
const ROSE_CHIP_FILL = composite("#ce7b8c20", PAGE);

/** 1.4.3 Contrast (Minimum), normal-size text. */
const TEXT = 4.5;
/** 1.4.11 Non-text Contrast, and 1.4.3's large-text allowance. */
const GRAPHIC = 3;

interface Pair {
  use: string;
  fg: string;
  bg: string;
  min: number;
}

/**
 * Every real (foreground, composited background) pair, with the role judgment
 * that sets its threshold. Measured ratios are in the trailing comments and in
 * docs/accessibility.md; the assertion is the threshold, not the figure, so
 * headroom can move without editing this table.
 */
const PAIRS: Pair[] = [
  // Landing vignette (app/page.tsx) — 16px `font-semibold` body copy inside a
  // sentence. Well under the 18.66px-bold large-text floor, so 4.5:1.
  { use: "landing vignette: person-a name", fg: TOKENS["person-a"], bg: PAGE, min: TEXT }, // 5.59
  { use: "landing vignette: person-b name", fg: TOKENS["person-b"], bg: PAGE, min: TEXT }, // 6.10
  { use: "landing vignette: overlap phrase", fg: TOKENS.overlap, bg: PAGE, min: TEXT }, // 5.54

  // Taste map member headings — `text-xl` (20px) `font-semibold`. 20px at
  // weight 600 arguably qualifies as large text (3:1), but "bold" is not
  // guaranteed at 600 in a variable face, so they are held to the text floor.
  { use: "taste map: person-a heading", fg: TOKENS["person-a"], bg: PAGE, min: TEXT }, // 5.59
  { use: "taste map: person-b heading", fg: TOKENS["person-b"], bg: PAGE, min: TEXT }, // 6.10
  { use: "taste map: person-c heading", fg: TOKENS["person-c"], bg: PAGE, min: TEXT }, // 7.34
  { use: "taste map: person-d heading", fg: TOKENS["person-d"], bg: PAGE, min: TEXT }, // 7.27
  { use: "taste map: overlap heading", fg: TOKENS.overlap, bg: PAGE, min: TEXT }, // 5.54

  // Vibe/genre tag pills — `text-xs` (12px) in the person color. Smallest
  // person-colored text in the app, and the strictest pair in this table.
  { use: "taste map: person-a tag label", fg: TOKENS["person-a"], bg: PAGE, min: TEXT }, // 5.59
  { use: "taste map: person-b tag label", fg: TOKENS["person-b"], bg: PAGE, min: TEXT }, // 6.10
  { use: "taste map: person-c tag label", fg: TOKENS["person-c"], bg: PAGE, min: TEXT }, // 7.34
  { use: "taste map: person-d tag label", fg: TOKENS["person-d"], bg: PAGE, min: TEXT }, // 7.27
  { use: "taste map: overlap tag label", fg: TOKENS.overlap, bg: PAGE, min: TEXT }, // 5.54

  // Legend swatches — 8px dots, `aria-hidden`, sitting beside each person's
  // name. They are what binds a color to a person for a sighted reader, so
  // they are a graphical object required to understand the content: 1.4.11.
  { use: "taste map legend: person-a swatch", fg: TOKENS["person-a"], bg: PAGE, min: GRAPHIC },
  { use: "taste map legend: person-b swatch", fg: TOKENS["person-b"], bg: PAGE, min: GRAPHIC },
  { use: "taste map legend: person-c swatch", fg: TOKENS["person-c"], bg: PAGE, min: GRAPHIC },
  { use: "taste map legend: person-d swatch", fg: TOKENS["person-d"], bg: PAGE, min: GRAPHIC },
  { use: "taste map legend: overlap swatch", fg: TOKENS.overlap, bg: PAGE, min: GRAPHIC },

  // Section rules and tag outlines. Decoration by the letter of 1.4.11 — the
  // heading and the label inside carry the same information in the same hue —
  // but they are the visible edge of a color-coded block, so 3:1 is asserted.
  { use: "taste map: person-a section rule", fg: TOKENS["person-a"], bg: PAGE, min: GRAPHIC },
  { use: "taste map: person-b section rule", fg: TOKENS["person-b"], bg: PAGE, min: GRAPHIC },
  { use: "taste map: person-c section rule", fg: TOKENS["person-c"], bg: PAGE, min: GRAPHIC },
  { use: "taste map: person-d section rule", fg: TOKENS["person-d"], bg: PAGE, min: GRAPHIC },
  { use: "taste map: overlap tag outline", fg: TOKENS.overlap, bg: PAGE, min: GRAPHIC },

  // Selected dealbreaker chip (components/chip.tsx, tone="rose"). Its label is
  // 14px on the chip's own translucent rose fill, not on the page.
  { use: "dealbreaker chip: label on its fill", fg: TOKENS["person-b"], bg: ROSE_CHIP_FILL, min: TEXT }, // 5.21
  // The chip is `role="checkbox"`: its border is the boundary of an interactive
  // component *and* the carrier of selected state. 3:1 against both neighbours.
  { use: "dealbreaker chip: border against the page", fg: TOKENS["person-b"], bg: PAGE, min: GRAPHIC }, // 6.10
  { use: "dealbreaker chip: border against its own fill", fg: TOKENS["person-b"], bg: ROSE_CHIP_FILL, min: GRAPHIC }, // 5.21
];

describe("person colors — every real pair", () => {
  it.each(PAIRS)("$use clears $min:1", ({ fg, bg, min }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});

describe("person colors — the enumeration is complete", () => {
  /**
   * Every file that paints a person or overlap color, with its occurrence
   * count. The table above is only a sweep if this list is the whole app, so a
   * new use fails here and forces the surface-and-role call to be made.
   * Each entry is `file: expected occurrence count`.
   */
  const ALLOWED: Record<string, number> = {
    // Three spans of body copy in the landing vignette, on the page background.
    "app/page.tsx": 3,
    // border-person-b + text-person-b + the #ce7b8c20 fill, selected rose chip.
    "components/chip.tsx": 3,
    // The four person vars and the overlap var, all on the results page background.
    "components/taste-map.tsx": 5,
  };

  const SRC = path.resolve(__dirname, "..");

  /** Every non-test source file, as `[relative path, contents]`. */
  function sources(): [string, string][] {
    const files: [string, string][] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          files.push([path.relative(SRC, full), readFileSync(full, "utf8")]);
        }
      }
    };
    walk(SRC);
    return files;
  }

  /**
   * Counts person/overlap color references per source file (tests excluded):
   * Tailwind utilities, `var(--token)` reads, and the raw hex values, since a
   * one-off `bg-[#…]` is how the rose chip fill is written.
   */
  function personColorUses(): Record<string, number> {
    const hexes = ["person-a", "person-b", "person-c", "person-d", "overlap"].map(
      (token) => TOKENS[token].slice(1)
    );
    const pattern = new RegExp(
      String.raw`(?:[a-z-]+-|var\(--)(?:person-[a-d]|overlap)\b|#(?:${hexes.join("|")})`,
      "gi"
    );
    const counts: Record<string, number> = {};
    for (const [file, contents] of sources()) {
      const hits = contents.match(pattern);
      if (hits) counts[file] = hits.length;
    }
    return counts;
  }

  it("matches the documented allowlist exactly", () => {
    expect(personColorUses()).toEqual(ALLOWED);
  });

  it("hands the color set to nobody outside the taste map", () => {
    // A component importing personColor()/PERSON_COLORS would paint these hues
    // on a surface this sweep never measured, without tripping the count above.
    const borrowers = sources()
      .filter(([file]) => file !== path.join("components", "taste-map.tsx"))
      .filter(([, contents]) => /\b(?:personColor|PERSON_COLORS)\b/.test(contents))
      .map(([file]) => file);
    expect(borrowers).toEqual([]);
  });
});

const FOUR: TasteMapData = {
  members: ["Alice", "Bob", "Cass", "Dev"].map((name, i) => ({
    userId: `u${i}`,
    name,
    summary: `${name} reaches for films that earn their ending.`,
    primaryVibes: ["Cerebral"],
    genreAffinities: ["Sci-Fi"],
  })),
  overlap: {
    summary: "You all light up for smart films with a heart underneath.",
    sharedVibes: ["Witty"],
    tensionPoints: ["One of you sits with ambiguity longer than the rest."],
  },
};

describe("person colors — the markup paints what the sweep measured", () => {
  it("uses no color in the taste map that misses the text floor on the page", () => {
    // Catches a color added anywhere in the component, not just the ones the
    // table names: every inline color reference is resolved and measured.
    const { container } = render(<TasteMap tasteMap={FOUR} showWeightingNote />);
    const referenced = new Set<string>();
    for (const el of container.querySelectorAll<HTMLElement>("[style]")) {
      for (const [, token] of (el.getAttribute("style") ?? "").matchAll(
        /var\(--([a-z0-9-]+)\)/g
      )) {
        referenced.add(token);
      }
    }

    expect([...referenced].sort()).toEqual([
      "overlap",
      "person-a",
      "person-b",
      "person-c",
      "person-d",
    ]);
    for (const token of referenced) {
      expect(contrastRatio(TOKENS[token], PAGE)).toBeGreaterThanOrEqual(TEXT);
    }
  });

  it("draws the selected dealbreaker chip in person-b over the rose fill", () => {
    render(<Chip label="Animal death" selected tone="rose" onToggle={() => {}} />);
    const chip = screen.getByRole("checkbox", { name: "Animal death" });
    expect(chip.className).toContain("text-person-b");
    expect(chip.className).toContain("border-person-b");
    // The fill is a literal translucent hex, so it has to be flattened over the
    // page before it means anything — comparing against it raw gives ~1:1.
    expect(chip.className).toContain(`bg-[${TOKENS["person-b"]}20]`);
    expect(contrastRatio(TOKENS["person-b"], "#ce7b8c20")).toBeLessThan(1.05);
  });
});

describe("person colors — standing constraints", () => {
  /**
   * Two near-misses that hold today only because of where these colors are
   * placed. Pinned as facts, in the same spirit as `ember` on `charcoal`: if a
   * palette change moves either one, this fails and the placement rule can be
   * revisited rather than silently relied on.
   */
  it("the dealbreaker chip must stay on the page, not on a charcoal panel", () => {
    expect(contrastRatio(TOKENS["person-b"], ROSE_CHIP_FILL)).toBeGreaterThanOrEqual(TEXT);
    expect(
      contrastRatio(TOKENS["person-b"], composite("#ce7b8c20", TOKENS.charcoal))
    ).toBeLessThan(TEXT); // 4.45
  });

  it("person-color text must stay out of an amber wash", () => {
    // The landing hero's starfield paints an amber-glow ellipse anchored at the
    // top edge; the vignette sits far below its fade-out. If that ever moves —
    // or overlap text is put on any amber-glow surface — this is the floor it
    // fails to clear.
    const washed = composite(TOKENS["amber-glow"], PAGE);
    expect(contrastRatio(TOKENS.overlap, washed)).toBeLessThan(TEXT); // 4.49
    expect(contrastRatio(TOKENS["person-a"], washed)).toBeGreaterThanOrEqual(TEXT); // 4.53
  });
});
