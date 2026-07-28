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
} from "@/components/control-classes";

const SRC = path.resolve(__dirname, "..");

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

describe("no call site re-spells the outlined treatment", () => {
  it("nothing inlines the secondary button string", () => {
    const offenders = sourceFiles()
      .filter(([file]) => file !== "components/control-classes.ts")
      .filter(([, src]) => src.includes("border border-ash px-xl"))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it("nothing spells out the boundary-plus-hover pair outside the module", () => {
    // Catches a near-copy that varies the size but re-states the a11y-critical part.
    const offenders = sourceFiles()
      .filter(([file]) => file !== "components/control-classes.ts")
      .filter(([, src]) => /border-ash[^"`]*hover:border-cream/.test(src))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
