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
