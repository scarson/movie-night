// ABOUTME: Pins the outlined-control classes to one definition — the 1.4.11 boundary
// ABOUTME: lives in exactly one place, so a contrast fix is a one-line change again.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  outlinedBoundaryClasses,
  outlinedControlClasses,
  secondaryButtonClasses,
  compactOutlinedButtonClasses,
  primaryFillClasses,
  primaryControlClasses,
  primaryButtonClasses,
  disabledFillClasses,
  disabledOutlinedClasses,
} from "@/components/control-classes";

const SRC = path.resolve(__dirname, "..");

/** Source files outside the module whose class strings match `pattern`. */
function callSitesSpelling(pattern: RegExp): string[] {
  return sourceFiles()
    .filter(([file]) => file !== "components/control-classes.ts")
    .filter(([, src]) => pattern.test(src))
    .map(([file]) => file);
}

/** Every non-test source file, as [repo-relative path, contents]. */
function sourceFiles(): [string, string][] {
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

describe("outlined control classes", () => {
  it("carry the 1.4.11 boundary and its hover", () => {
    // These are the tokens control-contrast.test.tsx measures. Keeping them in one
    // string is the whole point: the slate -> ash fix had to be applied at eight
    // call sites, and the next contrast change should be a one-line edit.
    expect(outlinedBoundaryClasses).toContain("border-ash");
    expect(outlinedBoundaryClasses).toContain("hover:border-cream");
    expect(outlinedBoundaryClasses).not.toContain("border-slate");
  });

  it("keep shape out of the boundary, so pill and panel controls can share it", () => {
    // Chips are rounded-pill and group rows rounded-panel; baking rounded-control
    // into the boundary is what forced those two to re-spell it by hand.
    expect(outlinedBoundaryClasses).not.toMatch(/rounded-/);
  });

  it("build every variant from the same boundary definition", () => {
    for (const variant of [
      outlinedControlClasses,
      secondaryButtonClasses,
      compactOutlinedButtonClasses,
    ]) {
      expect(variant).toContain(outlinedBoundaryClasses);
    }
    for (const button of [secondaryButtonClasses, compactOutlinedButtonClasses]) {
      expect(button).toContain(outlinedControlClasses);
    }
  });

  it("keep the two sizes distinct", () => {
    // The compact variant exists because a 48px control crowds an inline input row.
    expect(secondaryButtonClasses).toContain("min-h-12");
    expect(compactOutlinedButtonClasses).toContain("min-h-11");
    expect(secondaryButtonClasses).not.toBe(compactOutlinedButtonClasses);
  });
});

describe("primary fill classes", () => {
  it("carry the fill, the label colour it is measured against, and the hover", () => {
    // midnight on amber is 9.04:1 (docs/accessibility.md). Swapping the fill without
    // the label — or the reverse — is what would break it, so they travel together.
    expect(primaryFillClasses).toContain("bg-amber");
    expect(primaryFillClasses).toContain("text-midnight");
    expect(primaryFillClasses).toContain("hover:bg-warm-white");
  });

  it("keep shape and size out of the fill, so call sites can vary them", () => {
    // The landing CTA is inline-flex and the groups form button is 44px; bundling
    // either choice into the fill is what forced twelve sites to re-spell it.
    expect(primaryFillClasses).not.toMatch(/rounded-/);
    expect(primaryFillClasses).not.toMatch(/min-h-/);
  });

  it("build every variant from the same fill definition", () => {
    expect(primaryControlClasses).toContain(primaryFillClasses);
    expect(primaryButtonClasses).toContain(primaryControlClasses);
  });

  it("stand at the same height as the secondary button they pair with", () => {
    expect(primaryButtonClasses).toContain("min-h-12");
    expect(secondaryButtonClasses).toContain("min-h-12");
  });
});

describe("disabled control classes", () => {
  it("drop a filled control to the inactive fill, hover included", () => {
    expect(disabledFillClasses).toContain("disabled:bg-slate");
    expect(disabledFillClasses).toContain("disabled:text-ash");
    // `:hover` still matches a disabled button, and Tailwind resolves
    // `disabled:bg-slate` against `hover:bg-warm-white` by variant order rather
    // than specificity. The neutraliser is what makes the outcome definite.
    expect(disabledFillClasses).toContain("disabled:hover:bg-slate");
  });

  it("drop an outlined control's boundary to the inactive one, hover included", () => {
    expect(disabledOutlinedClasses).toContain("disabled:border-slate");
    expect(disabledOutlinedClasses).toContain("disabled:text-ash");
    expect(disabledOutlinedClasses).toContain("disabled:hover:border-slate");
    // The two bespoke ember buttons also set `hover:bg-ember hover:text-midnight`,
    // so this string neutralises fill and label as well as the boundary.
    expect(disabledOutlinedClasses).toContain("disabled:hover:bg-transparent");
    expect(disabledOutlinedClasses).toContain("disabled:hover:text-ash");
  });

  it("state each level in its own vocabulary and never the other's", () => {
    // DESIGN.md: filled controls drop the fill, outlined controls drop the
    // boundary. One rule, expressed twice — not two rules.
    //
    // Both sides match the bare token, so any prefix is caught. Pinning the
    // outlined side to a `disabled:`-prefixed pattern would let a bare or
    // `hover:`-prefixed slate fill through, which is the same violation.
    expect(disabledFillClasses).not.toMatch(/border-slate/);
    expect(disabledOutlinedClasses).not.toMatch(/bg-slate/);
  });

  it("reach every composed control", () => {
    for (const filled of [primaryControlClasses, primaryButtonClasses]) {
      expect(filled).toContain(disabledFillClasses);
    }
    for (const outlined of [
      outlinedControlClasses,
      secondaryButtonClasses,
      compactOutlinedButtonClasses,
    ]) {
      expect(outlined).toContain(disabledOutlinedClasses);
    }
  });

  it("are never expressed as opacity, anywhere in the source", () => {
    // Eight sites across five files carried five distinct strings, two of them
    // different opacity values. Opacity is outside the token system entirely.
    const opacitySites = sourceFiles()
      .filter(([, src]) => /disabled:opacity-/.test(src))
      .map(([file]) => file);
    expect(opacitySites).toEqual([]);
  });
});

describe("no call site re-spells the outlined treatment", () => {
  it("nothing inlines the secondary button string", () => {
    expect(callSitesSpelling(/border border-ash px-xl/)).toEqual([]);
  });

  it("nothing spells out the boundary-plus-hover pair outside the module", () => {
    // Catches a near-copy that varies the size but re-states the a11y-critical part.
    expect(callSitesSpelling(/border-ash[^"`]*hover:border-cream/)).toEqual([]);
  });
});

describe("no call site re-spells the primary treatment", () => {
  it("nothing inlines the primary button string", () => {
    expect(callSitesSpelling(/bg-amber px-xl/)).toEqual([]);
  });

  it("nothing spells out the fill-plus-label pair outside the module", () => {
    // Catches a near-copy that varies the size but re-states the contrast-critical part.
    expect(callSitesSpelling(/bg-amber[^"`]*hover:bg-warm-white/)).toEqual([]);
  });
});
