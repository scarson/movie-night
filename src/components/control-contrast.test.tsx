// @vitest-environment jsdom
// ABOUTME: WCAG 1.4.11 guard — interactive controls must not draw their resting
// ABOUTME: boundary in slate (1.53:1), and every remaining slate use must be non-interactive.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { contrastRatio, TOKENS } from "@/test/contrast";
import { Chip } from "@/components/chip";
import { ToggleRow } from "@/components/toggle-row";
import { RoughDayToggle } from "@/components/rough-day-toggle";
import { GroupPicker } from "@/components/group-picker";
import { TagPicker } from "@/components/tag-picker";
import { RefinePanel } from "@/components/refine-panel";

/**
 * The boundary token for interactive controls. Everything asserted below hangs
 * off this being the one that clears 3:1 — see contrast.test.ts for the maths.
 */
const CONTROL_BORDER = "border-ash";

/**
 * A slate boundary in any state 1.4.11 governs. The criterion exempts inactive
 * components, and DESIGN.md §Accessibility sanctions slate for disabled controls,
 * so a `disabled:`-prefixed utility must not trip these assertions. Carving out
 * that one prefix leaves every other inside the assertion — `hover:`, `focus:`,
 * responsive and arbitrary variants all still fail, as does a bare token.
 */
const UNSANCTIONED_SLATE_BORDER = /(^|\s)(?!disabled:)\S*border-slate\b/;

describe("1.4.11 — resting control boundaries", () => {
  it("ash clears 3:1 on both surfaces a control can sit on", () => {
    expect(contrastRatio(TOKENS.ash, TOKENS.midnight)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(TOKENS.ash, TOKENS.charcoal)).toBeGreaterThanOrEqual(3);
  });

  it("an unselected chip draws its boundary in ash", () => {
    render(<Chip label="Cozy" selected={false} onToggle={() => {}} />);
    const chip = screen.getByRole("checkbox", { name: "Cozy" });
    expect(chip.className).toContain(CONTROL_BORDER);
    expect(chip.className).not.toMatch(UNSANCTIONED_SLATE_BORDER);
  });

  it("an unchecked switch row draws its boundary in ash", () => {
    render(<ToggleRow label="Reduce animations" checked={false} onChange={() => {}} />);
    const toggle = screen.getByRole("switch", { name: "Reduce animations" });
    expect(toggle.className).toContain(CONTROL_BORDER);
    expect(toggle.className).not.toMatch(UNSANCTIONED_SLATE_BORDER);
  });

  it("an unchecked rough-day toggle draws its boundary in ash", () => {
    render(<RoughDayToggle name="Bob" checked={false} onChange={() => {}} />);
    const toggle = screen.getByRole("switch", { name: "Bob had a rough day" });
    expect(toggle.className).toContain(CONTROL_BORDER);
    expect(toggle.className).not.toMatch(UNSANCTIONED_SLATE_BORDER);
  });

  it("an unselected group row draws its boundary in ash", () => {
    render(
      <GroupPicker
        groups={[{ id: "g1", name: "Us", members: [] }]}
        value={null}
        onChange={() => {}}
      />
    );
    // The row is the label wrapping the radio; the radio itself carries no border.
    const row = screen.getByRole("radio", { name: /Us/ }).closest("label");
    expect(row?.className).toContain(CONTROL_BORDER);
    expect(row?.className).not.toMatch(UNSANCTIONED_SLATE_BORDER);
  });

  it("the custom-tag input and its Add button draw boundaries in ash", () => {
    render(<TagPicker selected={[]} onChange={() => {}} />);
    const input = screen.getByLabelText("Add a custom tag");
    const add = screen.getByRole("button", { name: "Add" });
    for (const el of [input, add]) {
      expect(el.className).toContain(CONTROL_BORDER);
      expect(el.className).not.toMatch(UNSANCTIONED_SLATE_BORDER);
    }
  });
});

describe("1.4.11 — the switch track is a state graphic, not decoration", () => {
  it("an off switch shows a track boundary and knob that clear 3:1", () => {
    // Knob position is the only visual carrier of on/off, so both the track
    // against the panel and the knob against the track need 3:1.
    render(<ToggleRow label="Reduce animations" checked={false} onChange={() => {}} />);
    const track = screen
      .getByRole("switch", { name: "Reduce animations" })
      .querySelector("[aria-hidden='true']");
    expect(track, "switch track not found").not.toBeNull();
    const knob = track!.firstElementChild;
    expect(knob, "switch knob not found").not.toBeNull();

    expect(track!.className).toContain("ring-ash");
    expect(knob!.className).toContain("bg-ash");
    expect(contrastRatio(TOKENS.ash, TOKENS.charcoal)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(TOKENS.ash, TOKENS.slate)).toBeGreaterThanOrEqual(3);
  });
});

describe("a disabled control leaves the amber hierarchy", () => {
  /**
   * 1.4.3 and 1.4.11 both exempt inactive components, so this is a legibility
   * and consistency rule rather than a conformance gate — see DESIGN.md
   * §Accessibility. `ash` on `slate` measures 4.06:1.
   *
   * Asserted on a real call site rather than on the class constant: a render of
   * `<button className={primaryButtonClasses}>` would only re-state its own
   * input. The constants themselves are pinned in `control-classes.test.ts`.
   */
  const REFINE_PANEL = {
    round: 1,
    maxRounds: 10,
    keptCount: 0,
    removedCount: 0,
    carriedRemovedCount: 0,
    steering: "",
    onSteeringChange: () => {},
    onRegenerate: () => {},
    onStartOver: () => {},
  };

  it("a spent regenerate button drops the amber fill to slate, not to opacity", () => {
    render(<RefinePanel {...REFINE_PANEL} exhausted />);
    const button = screen.getByTestId("regenerate");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.className).toContain("disabled:bg-slate");
    expect(button.className).toContain("disabled:text-ash");
    expect(button.className).not.toMatch(/disabled:opacity-/);
    // The filled level never borrows the outlined level's vocabulary.
    expect(button.className).not.toContain("disabled:border-slate");
  });

  it("the outlined counterweight beside it keeps its resting boundary", () => {
    // "Start over" is never disabled, so the disabled variants must not change
    // what it draws at rest — the treatment is inert until :disabled matches.
    render(<RefinePanel {...REFINE_PANEL} exhausted />);
    const startOver = screen.getByRole("button", { name: "Start over" });
    expect(startOver.hasAttribute("disabled")).toBe(false);
    expect(startOver.className).toContain(CONTROL_BORDER);
    expect(startOver.className).toContain("disabled:border-slate");
  });
});

describe("1.4.11 — every remaining slate use is non-interactive", () => {
  /**
   * `slate` is 1.53:1 on midnight and 1.34:1 on charcoal, so it may only draw
   * things 1.4.11 does not govern: dividers, panel edges, hover washes, and the
   * boundaries of *disabled* controls (explicitly exempt as "inactive components").
   * Each entry is `file: expected occurrence count`. Adding a new slate boundary
   * fails this test, forcing the interactive-or-not call to be made deliberately.
   */
  const ALLOWED: Record<string, number> = {
    // The one sanctioned home for the disabled treatment: an inactive fill and an
    // inactive boundary, each with its hover neutraliser. Every disabled control
    // in the app inherits from here, which is why no page file carries one.
    "components/control-classes.ts": 4,
    // Section rules and dividers between blocks of content.
    "app/page.tsx": 1,
    "app/quick/page.tsx": 1,
    "app/tonight/page.tsx": 1,
    "app/ritual/page.tsx": 1,
    "app/privacy/page.tsx": 3, // list bullet markers; list structure carries the meaning
    "app/profile/page.tsx": 1, // section divider
    "app/groups/page.tsx": 5, // 2 panel edges, code display, 2 dividers
    "app/groups/join/[code]/page.tsx": 1, // invite-code display, not a control
    "app/results/[sessionId]/page.tsx": 1, // rail under the tablist; tabs mark themselves in amber
    "components/site-footer.tsx": 1,
    "components/taste-map.tsx": 1,
    "components/nav.tsx": 3, // menu panel edge + two hover washes
    "components/mood-screen.tsx": 2, // panel edge + divider
    "components/refine-panel.tsx": 1, // panel edge
    "components/title-search.tsx": 3, // results panel edge, option divider, hover wash
    "components/ranked-list.tsx": 2, // row divider + non-interactive genre tag
    "components/progress-steps.tsx": 2, // upcoming marker + connector, both aria-hidden
    "components/group-picker.tsx": 1, // decorative avatar fallback fill
    "components/toggle-row.tsx": 1, // off-track fill, which the ash ring makes discernible
  };

  const SRC = path.resolve(__dirname, "..");

  /** Counts `-slate` utility references per source file (tests excluded). */
  function slateUses(): Record<string, number> {
    const counts: Record<string, number> = {};
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const hits = readFileSync(full, "utf8").match(/-slate\b/g);
          if (hits) counts[path.relative(SRC, full)] = hits.length;
        }
      }
    };
    walk(SRC);
    return counts;
  }

  it("matches the documented allowlist exactly", () => {
    expect(slateUses()).toEqual(ALLOWED);
  });
});

describe("no state is drawn with opacity", () => {
  /**
   * DESIGN.md §Accessibility: opacity is outside the token system and compounds
   * with whatever sits underneath, so it may not carry state. Measured against
   * `midnight`, a 50% wash takes `ash` from 6.21:1 to **2.46:1** and `amber`
   * from 9.04:1 to 3.09:1 — under the 4.5:1 text floor and, for a live control's
   * boundary, under 1.4.11's 3:1.
   *
   * The rule has a second edge that source review cannot see. An element that
   * also carries `animate-rise-fade` runs an animation whose `both` fill holds
   * `opacity: 1`, and animation declarations outrank author-normal ones — so an
   * `opacity-*` utility beside it does nothing at all, right up until reduced
   * motion drops the animation with `animation: none !important` and it starts
   * working. The wash would then appear *only* for the people who asked for less
   * motion. That is why this is a repo-wide sweep and not an assertion on one
   * component.
   *
   * The allowlist is empty on purpose. An entry here has to argue why a wash is
   * the right vocabulary when the palette already has slate and ash for inactive.
   */
  const ALLOWED: Record<string, number> = {};

  const SRC = path.resolve(__dirname, "..");

  /** Counts `opacity-*` utility references per source file (tests excluded). */
  function opacityUses(): Record<string, number> {
    const counts: Record<string, number> = {};
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const hits = readFileSync(full, "utf8").match(/\bopacity-/g);
          if (hits) counts[path.relative(SRC, full)] = hits.length;
        }
      }
    };
    walk(SRC);
    return counts;
  }

  it("matches the documented allowlist exactly", () => {
    expect(opacityUses()).toEqual(ALLOWED);
  });
});
