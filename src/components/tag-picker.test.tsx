// @vitest-environment jsdom
// ABOUTME: Tests for TagPicker — preset groups, selection toggling, and the
// ABOUTME: custom tag input (Enter adds, 30-char limit, dedupe, removable).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TagPicker } from "@/components/tag-picker";
import { MOOD_TAGS, GENRE_TAGS } from "@/config/tags";

function setup(selected: string[] = [], onChange = vi.fn()) {
  render(<TagPicker selected={selected} onChange={onChange} />);
  return onChange;
}

describe("TagPicker", () => {
  it("renders the Moods & Tones group then the Genres group with all presets", () => {
    setup();
    const groups = screen.getAllByRole("group");
    expect(groups).toHaveLength(2);
    expect(within(groups[0]).getByText("Moods & Tones")).toBeDefined();
    expect(within(groups[1]).getByText("Genres")).toBeDefined();
    for (const tag of MOOD_TAGS) {
      expect(within(groups[0]).getByRole("checkbox", { name: tag })).toBeDefined();
    }
    for (const tag of GENRE_TAGS) {
      expect(within(groups[1]).getByRole("checkbox", { name: tag })).toBeDefined();
    }
  });

  it("adds a preset tag on click", () => {
    const onChange = setup(["Cozy"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Funny" }));
    expect(onChange).toHaveBeenCalledWith(["Cozy", "Funny"]);
  });

  it("removes an already-selected preset tag on click", () => {
    const onChange = setup(["Cozy", "Funny"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Cozy" }));
    expect(onChange).toHaveBeenCalledWith(["Funny"]);
  });

  it("marks selected presets with aria-checked", () => {
    setup(["Cozy"]);
    expect(
      screen.getByRole("checkbox", { name: "Cozy" }).getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen.getByRole("checkbox", { name: "Funny" }).getAttribute("aria-checked")
    ).toBe("false");
  });

  it("adds a trimmed custom tag on Enter and clears the input", () => {
    const onChange = setup(["Cozy"]);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  found footage " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["Cozy", "found footage"]);
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("adds a custom tag via the Add button", () => {
    const onChange = setup([]);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "noir" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).toHaveBeenCalledWith(["noir"]);
  });

  it("does not add a duplicate tag (case-insensitive)", () => {
    const onChange = setup(["Cozy", "noir"]);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "cozy" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "NOIR" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("folds a custom entry that matches a preset into the preset's canonical casing", () => {
    // Typing a preset's name in the wrong case must not create a second,
    // near-duplicate custom chip alongside the preset — the header promises
    // case-insensitive dedupe, and two decoupled toggles reach the prompt.
    const onChange = setup([]);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "horror" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["Horror"]);
  });

  it("rejects custom tags over 30 characters", () => {
    const onChange = setup([]);
    const input = screen.getByRole("textbox");
    expect(input.getAttribute("maxlength")).toBe("30");
    fireEvent.change(input, { target: { value: "x".repeat(31) } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not add an empty custom tag", () => {
    const onChange = setup([]);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders custom (non-preset) tags as removable chips", () => {
    const onChange = setup(["Cozy", "found footage"]);
    const custom = screen.getByRole("checkbox", { name: "found footage" });
    expect(custom.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(custom);
    expect(onChange).toHaveBeenCalledWith(["Cozy"]);
  });
});

/** The 30 presets — 16 moods + 14 genres, which is also the server's cap. */
const ALL_PRESETS = [...MOOD_TAGS, ...GENRE_TAGS];

describe("TagPicker entry limit", () => {
  it("refuses a 31st tag and says why", () => {
    // 29 presets plus one custom entry fills the cap while leaving one preset
    // chip unselected to tap.
    const onChange = vi.fn();
    const atCap = [...ALL_PRESETS.slice(0, 29), "found footage"];
    render(<TagPicker selected={atCap} onChange={onChange} />);

    const spare = screen.getByRole("checkbox", { name: ALL_PRESETS[29] });
    expect(spare.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(spare);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("30 is the limit — remove one first.")).toBeTruthy();
  });

  it("refuses a custom tag past the limit", () => {
    const onChange = vi.fn();
    render(<TagPicker selected={ALL_PRESETS} onChange={onChange} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "rainy sunday" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("30 is the limit — remove one first.")).toBeTruthy();
  });

  it("deselecting past the limit works and clears the message", () => {
    const onChange = vi.fn();
    render(<TagPicker selected={ALL_PRESETS} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "rainy sunday" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText(/is the limit/)).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: ALL_PRESETS[0] }));

    expect(onChange).toHaveBeenCalledWith(ALL_PRESETS.slice(1));
    expect(onChange.mock.calls[0][0]).toHaveLength(29);
    // Controlled component: `selected` is still 30 on this render, so what has
    // to change is the message — back from the refusal to the plain count.
    expect(screen.queryByText(/is the limit/)).toBeNull();
    expect(screen.getByText("30 of 30 chosen")).toBeTruthy();
  });

  it("never emits 31 entries down the reported path: every preset, then a custom tag", () => {
    // The reported reproduction. 16 mood + 14 genre chips is exactly the
    // server's 30-entry cap, so one custom tag on top is a hard 400.
    const onChange = vi.fn();
    let selected: string[] = [];
    const { rerender } = render(<TagPicker selected={selected} onChange={onChange} />);

    for (const tag of ALL_PRESETS) {
      fireEvent.click(screen.getByRole("checkbox", { name: tag }));
      selected = onChange.mock.lastCall?.[0] ?? selected;
      rerender(<TagPicker selected={selected} onChange={onChange} />);
    }
    expect(selected).toHaveLength(30);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "rainy sunday" } });
    fireEvent.keyDown(input, { key: "Enter" });

    for (const call of onChange.mock.calls) {
      expect((call[0] as string[]).length).toBeLessThanOrEqual(30);
    }
  });

  it("honours an explicit max below the default", () => {
    const onChange = vi.fn();
    render(<TagPicker selected={["Cozy", "Funny", "Thrilling"]} onChange={onChange} max={3} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Romantic" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("3 is the limit — remove one first.")).toBeTruthy();
  });
});
