// @vitest-environment jsdom
// ABOUTME: Tests for the mood step — vibe selection, discover-new, the capped mood note,
// ABOUTME: the solo-hidden rough-day toggle, and the summary's rough-day privacy guarantee.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MoodScreen, type MoodScreenProps } from "@/components/mood-screen";
import { MOOD_TAGS, GENRE_TAGS } from "@/config/tags";

function baseProps(overrides: Partial<MoodScreenProps> = {}): MoodScreenProps {
  return {
    moodVibes: [],
    onMoodVibesChange: vi.fn(),
    moodText: "",
    onMoodTextChange: vi.fn(),
    discoverNew: false,
    onDiscoverNewChange: vi.fn(),
    roughDay: false,
    onRoughDayChange: vi.fn(),
    otherMemberNames: ["Bob"],
    you: { name: "Alice", vibes: ["Cozy"], comfortCount: 3, watchlistCount: 2 },
    ...overrides,
  };
}

describe("MoodScreen", () => {
  it("reports a tonight's-vibe selection", () => {
    const onMoodVibesChange = vi.fn();
    render(<MoodScreen {...baseProps({ moodVibes: ["Cozy"], onMoodVibesChange })} />);

    const vibes = screen.getByRole("group", { name: /tonight/i });
    fireEvent.click(within(vibes).getByRole("checkbox", { name: "Funny" }));

    expect(onMoodVibesChange).toHaveBeenCalledWith(["Cozy", "Funny"]);
  });

  it("reports the discover-new switch", () => {
    const onDiscoverNewChange = vi.fn();
    render(<MoodScreen {...baseProps({ onDiscoverNewChange })} />);

    fireEvent.click(screen.getByRole("switch", { name: /something new/i }));
    expect(onDiscoverNewChange).toHaveBeenCalledWith(true);
  });

  it("caps the mood note at 200 characters and reports edits", () => {
    const onMoodTextChange = vi.fn();
    render(<MoodScreen {...baseProps({ onMoodTextChange })} />);

    const note = screen.getByRole("textbox", { name: /anything else/i });
    expect(note.getAttribute("maxLength")).toBe("200");
    fireEvent.change(note, { target: { value: "Long week." } });
    expect(onMoodTextChange).toHaveBeenCalledWith("Long week.");
  });

  it("names the rough-day toggle for the other member and reports it", () => {
    const onRoughDayChange = vi.fn();
    render(<MoodScreen {...baseProps({ onRoughDayChange })} />);

    fireEvent.click(screen.getByRole("switch", { name: "Bob had a rough day" }));
    expect(onRoughDayChange).toHaveBeenCalledWith(true);
  });

  it("hides the rough-day toggle when watching alone", () => {
    render(<MoodScreen {...baseProps({ otherMemberNames: [] })} />);

    expect(screen.queryByRole("switch", { name: /rough day/i })).toBeNull();
  });

  it("summarises your own profile and names the others without their data", () => {
    render(<MoodScreen {...baseProps()} />);

    const summary = screen.getByRole("group", { name: /tonight's session|session/i });
    expect(within(summary).getByText("Alice")).toBeTruthy();
    expect(within(summary).getByText(/3 comfort/)).toBeTruthy();
    expect(within(summary).getByText(/2 watchlist/)).toBeTruthy();
    expect(within(summary).getByText("Bob")).toBeTruthy();
    expect(within(summary).getByText(/saved profile/i)).toBeTruthy();
  });

  it("never reveals rough-day state in the summary", () => {
    const { container } = render(
      <MoodScreen {...baseProps({ roughDay: true })} />
    );

    const summary = screen.getByRole("group", { name: /session/i });
    expect(summary.textContent).not.toMatch(/rough day/i);
    expect(summary.textContent).not.toMatch(/prioriti/i);
    // The only rough-day mention on the page is the toggle the owner set.
    const mentions = (container.textContent ?? "").match(/rough day/gi) ?? [];
    expect(mentions).toHaveLength(1);
  });

  it("lists two members who share a name without a duplicate-key warning", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<MoodScreen {...baseProps({ otherMemberNames: ["Alex", "Alex"] })} />);

    const summary = screen.getByRole("group", { name: /session/i });
    expect(within(summary).getAllByText("Alex")).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("tells you the picks are unweighted when no mood is chosen", () => {
    render(<MoodScreen {...baseProps({ moodVibes: [] })} />);
    expect(screen.getByText(/surprise us/i)).toBeTruthy();
  });
});

describe("MoodScreen vibe ceiling", () => {
  // The 30-entry cap belongs to POST /api/movie-sessions. Asserting it here
  // rather than only on TagPicker is what pins the wiring: TagPicker's own
  // default is also 30, so a dropped `max` prop is invisible to its tests.
  const ALL_PRESETS = [...MOOD_TAGS, ...GENRE_TAGS];

  it("refuses a 31st vibe, the ceiling the session endpoint enforces", () => {
    const onMoodVibesChange = vi.fn();
    const atCap = [...ALL_PRESETS.slice(0, 29), "rainy sunday"];
    render(<MoodScreen {...baseProps({ moodVibes: atCap, onMoodVibesChange })} />);

    const vibes = screen.getByRole("group", { name: /tonight/i });
    fireEvent.click(within(vibes).getByRole("checkbox", { name: ALL_PRESETS[29] }));

    expect(onMoodVibesChange).not.toHaveBeenCalled();
    expect(within(vibes).getByText("30 is the limit — remove one first.")).toBeTruthy();
  });
});
