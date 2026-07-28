// ABOUTME: Validates the WCAG contrast helper against reference pairs, then pins the
// ABOUTME: palette facts the design system depends on so a token edit can't silently break AA.
import { describe, it, expect } from "vitest";
import { contrastRatio, TOKENS } from "@/test/contrast";

describe("contrastRatio", () => {
  // Reference pairs from the WCAG 2.x relative-luminance definition. If these
  // drift, every other number in this file and in DESIGN.md is untrustworthy.
  it.each([
    ["#ffffff", "#000000", 21.0],
    ["#777777", "#ffffff", 4.48],
    ["#ffffff", "#ffffff", 1.0],
  ])("computes %s on %s as %s:1", (fg, bg, expected) => {
    expect(contrastRatio(fg, bg)).toBeCloseTo(expected, 2);
  });

  it("is symmetric — order of the pair does not change the ratio", () => {
    expect(contrastRatio(TOKENS.cream, TOKENS.midnight)).toBeCloseTo(
      contrastRatio(TOKENS.midnight, TOKENS.cream),
      10
    );
  });

  it("accepts shorthand hex", () => {
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21.0, 2);
  });
});

describe("palette contrast facts", () => {
  const SURFACES = ["midnight", "charcoal"] as const;

  // 1.4.11: the visual boundary of an interactive component needs 3:1.
  it.each(SURFACES)("ash clears the 3:1 non-text floor on %s", (surface) => {
    expect(contrastRatio(TOKENS.ash, TOKENS[surface])).toBeGreaterThanOrEqual(3);
  });

  it.each(SURFACES)("slate fails the 3:1 non-text floor on %s", (surface) => {
    // Documents *why* slate cannot be a control boundary. If a future palette
    // change lifts slate above 3:1 this test fails and the border rule can be revisited.
    expect(contrastRatio(TOKENS.slate, TOKENS[surface])).toBeLessThan(3);
  });

  // 1.4.3: normal-size text needs 4.5:1.
  it.each(SURFACES)("cream clears the 4.5:1 text floor on %s", (surface) => {
    expect(contrastRatio(TOKENS.cream, TOKENS[surface])).toBeGreaterThanOrEqual(4.5);
  });

  it("ember carries text on midnight but not on charcoal", () => {
    // The standing token rule from DESIGN.md, pinned so it can't be forgotten.
    expect(contrastRatio(TOKENS.ember, TOKENS.midnight)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(TOKENS.ember, TOKENS.charcoal)).toBeLessThan(4.5);
  });

  it("amber focus ring clears 3:1 on both surfaces", () => {
    for (const surface of SURFACES) {
      expect(contrastRatio(TOKENS.amber, TOKENS[surface])).toBeGreaterThanOrEqual(3);
    }
  });
});
