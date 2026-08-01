// @vitest-environment jsdom
// ABOUTME: Tests for GroupPicker — solo is always offered, the default selection rule,
// ABOUTME: and radio semantics (single choice, solo reported as null).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  GroupPicker,
  defaultGroupSelection,
  type GroupOption,
} from "@/components/group-picker";
import { clippingUtilities } from "@/test/clipping";

const alice = { userId: "u1", name: "Alice Chen", avatarUrl: null };
const bob = { userId: "u2", name: "Bob Reyes", avatarUrl: null };

const couple: GroupOption = {
  id: "g1",
  name: "Sunday Nights",
  members: [alice, bob],
};
const friends: GroupOption = {
  id: "g2",
  name: "The Film Club",
  members: [alice, bob, { userId: "u3", name: "Cleo Park", avatarUrl: null }],
};

describe("defaultGroupSelection", () => {
  it("defaults to solo when the user has no groups", () => {
    expect(defaultGroupSelection([])).toBe(null);
  });

  it("auto-selects the group when the user has exactly one", () => {
    expect(defaultGroupSelection([couple])).toBe("g1");
  });

  it("defaults to solo when the user has several groups, so no group is assumed", () => {
    expect(defaultGroupSelection([couple, friends])).toBe(null);
  });
});

describe("GroupPicker", () => {
  it("always offers 'Just me tonight', even with no groups", () => {
    render(<GroupPicker groups={[]} value={null} onChange={vi.fn()} />);
    const solo = screen.getByRole("radio", { name: /just me tonight/i });
    expect((solo as HTMLInputElement).checked).toBe(true);
  });

  it("renders one option per group plus solo, with members named", () => {
    render(
      <GroupPicker groups={[couple, friends]} value="g1" onChange={vi.fn()} />
    );
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(
      (screen.getByRole("radio", { name: /Sunday Nights/ }) as HTMLInputElement)
        .checked
    ).toBe(true);
    expect(screen.getByText("Alice Chen, Bob Reyes")).toBeDefined();
    expect(screen.getByText("Alice Chen, Bob Reyes, Cleo Park")).toBeDefined();
  });

  it("reports the group id when a group is chosen", () => {
    const onChange = vi.fn();
    render(
      <GroupPicker groups={[couple, friends]} value={null} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole("radio", { name: /The Film Club/ }));
    expect(onChange).toHaveBeenCalledWith("g2");
  });

  it("reports null when solo is chosen", () => {
    const onChange = vi.fn();
    render(
      <GroupPicker groups={[couple]} value="g1" onChange={onChange} />
    );
    fireEvent.click(screen.getByRole("radio", { name: /just me tonight/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("groups the options under one accessible name so they read as one question", () => {
    render(<GroupPicker groups={[couple]} value="g1" onChange={vi.fn()} />);
    expect(screen.getByRole("radiogroup", { name: /who's watching/i })).toBeDefined();
  });
});

describe("1.4.10 Reflow — the member list", () => {
  const longNames: GroupOption = {
    id: "g3",
    name: "Sunday Nights",
    members: [
      { userId: "u1", name: "Alexandra Featherstonehaugh", avatarUrl: null },
      { userId: "u2", name: "Jordan", avatarUrl: null },
    ],
  };

  it("declares no clipping utility on the member list, so it wraps (structural guard)", () => {
    // 1.4.10 Reflow. At 320px these names need ~43px more than the row gives
    // them, so `truncate` drops the tail silently — no scrollbar, no title, and
    // nothing a document-level `scrollWidth` sweep can see.
    //
    // jsdom has no layout engine: scrollWidth and clientWidth read 0 for every
    // element, so this assertion is structural and CANNOT prove the visual fix.
    // The geometric check — `scrollWidth <= clientWidth` on this element's own
    // box at 320x800 — lives in the browser runbook at
    // dev/reports/2026-08-01-authenticated-a11y-verification.md §Part 1.
    render(<GroupPicker groups={[longNames]} value={null} onChange={vi.fn()} />);

    const line = screen.getByText("Alexandra Featherstonehaugh, Jordan");
    // Denylist rather than just "not truncate", and it covers every clamp:
    // unbounded wrapping is the requirement, and a line-clamp of any depth
    // still discards whatever does not fit — the same loss of information
    // 1.4.10 forbids, one line further down.
    expect(clippingUtilities(line)).toEqual([]);
    expect(line.className.split(/\s+/)).toContain("break-words");
  });

  it("keeps the full member list in the DOM", () => {
    render(<GroupPicker groups={[longNames]} value={null} onChange={vi.fn()} />);
    expect(screen.getByText("Alexandra Featherstonehaugh, Jordan")).toBeDefined();
  });

  it("keeps the group name unclipped above it", () => {
    // The name was never truncated and must stay that way.
    render(<GroupPicker groups={[longNames]} value={null} onChange={vi.fn()} />);
    expect(screen.getByText("Sunday Nights").className).not.toContain("truncate");
  });
});
