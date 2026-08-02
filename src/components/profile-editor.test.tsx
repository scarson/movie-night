// @vitest-environment jsdom
// ABOUTME: Tests for the taste-profile editor — section coverage, per-field draft updates
// ABOUTME: that never clobber sibling fields, and the vibes/dealbreakers separation.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import {
  ProfileEditor,
  STREAMING_SERVICES,
  type ProfileDraft,
} from "@/components/profile-editor";
import { MOOD_TAGS, GENRE_TAGS } from "@/config/tags";

const ARRIVAL = { tmdbId: 1, title: "Arrival", year: 2016, posterPath: "/a.jpg" };

const DRAFT: ProfileDraft = {
  comfortTitles: [ARRIVAL],
  watchlist: [],
  vibes: ["Cozy"],
  dealbreakers: ["Horror"],
  streamingServices: ["Netflix"],
};

function renderEditor(value: ProfileDraft = DRAFT) {
  const onChange = vi.fn();
  render(<ProfileEditor value={value} onChange={onChange} />);
  return onChange;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProfileEditor", () => {
  it("renders all five profile sections", () => {
    renderEditor();

    for (const heading of [
      /comfort/i,
      /watchlist/i,
      /i want/i,
      /dealbreakers/i,
      /streaming/i,
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }
  });

  it("shows the saved comfort titles by name", () => {
    renderEditor();
    expect(screen.getByRole("checkbox", { name: /Arrival/ })).toBeTruthy();
  });

  it("updates vibes without touching dealbreakers", () => {
    const onChange = renderEditor();
    const wanted = screen.getByRole("group", { name: /i want/i });

    fireEvent.click(within(wanted).getByRole("checkbox", { name: "Funny" }));

    expect(onChange).toHaveBeenCalledWith({
      ...DRAFT,
      vibes: ["Cozy", "Funny"],
    });
  });

  it("updates dealbreakers without touching vibes", () => {
    const onChange = renderEditor();
    const dealbreakers = screen.getByRole("group", { name: /dealbreakers/i });

    fireEvent.click(within(dealbreakers).getByRole("checkbox", { name: "Horror" }));

    expect(onChange).toHaveBeenCalledWith({ ...DRAFT, dealbreakers: [] });
  });

  it("offers every streaming service and toggles selection", () => {
    const onChange = renderEditor();
    const services = screen.getByRole("group", { name: /streaming/i });

    for (const service of STREAMING_SERVICES) {
      expect(within(services).getByRole("checkbox", { name: service })).toBeTruthy();
    }
    fireEvent.click(within(services).getByRole("checkbox", { name: "MUBI" }));

    expect(onChange).toHaveBeenCalledWith({
      ...DRAFT,
      streamingServices: ["Netflix", "MUBI"],
    });
  });

  it("offers HBO Max under its full brand name", () => {
    renderEditor();
    const services = screen.getByRole("group", { name: /streaming/i });

    expect(within(services).getByRole("checkbox", { name: "HBO Max" })).toBeTruthy();
    expect(within(services).queryByRole("checkbox", { name: "Max" })).toBeNull();
  });

  it("deselects an already-chosen streaming service", () => {
    const onChange = renderEditor();
    const services = screen.getByRole("group", { name: /streaming/i });

    fireEvent.click(within(services).getByRole("checkbox", { name: "Netflix" }));

    expect(onChange).toHaveBeenCalledWith({ ...DRAFT, streamingServices: [] });
  });

  it("keeps the comfort and watchlist pickers independent", () => {
    const onChange = renderEditor();
    const comfort = screen.getByRole("group", { name: /comfort/i });

    // Removing the one comfort title must leave the watchlist alone.
    fireEvent.click(within(comfort).getByRole("checkbox", { name: /Arrival/ }));

    expect(onChange).toHaveBeenCalledWith({
      ...DRAFT,
      comfortTitles: [],
    });
  });
});

describe("ProfileEditor list ceilings", () => {
  // The 30-tag / 50-title caps belong to PUT /api/user/profile. These prove
  // each ceiling is reachable through the composed editor and equals the
  // server's. They cannot prove the `max` props are passed — every picker
  // defaults to the same number, so removing them changes no behaviour. See
  // the note on the second test.
  const ALL_PRESETS = [...MOOD_TAGS, ...GENRE_TAGS];

  function titles(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      tmdbId: 1000 + i,
      title: `Filler ${i}`,
      year: 2000 + i,
      posterPath: null,
    }));
  }

  it("refuses a 31st entry in each tag list", () => {
    for (const field of ["I want", "Dealbreakers"] as const) {
      const onChange = vi.fn();
      const atCap = [...ALL_PRESETS.slice(0, 29), "found footage"];
      render(
        <ProfileEditor
          value={{ ...DRAFT, vibes: atCap, dealbreakers: atCap }}
          onChange={onChange}
        />
      );
      const section = screen.getByRole("group", { name: new RegExp(field, "i") });
      fireEvent.click(within(section).getByRole("checkbox", { name: ALL_PRESETS[29] }));

      expect(onChange).not.toHaveBeenCalled();
      expect(within(section).getByText("30 is the limit — remove one first.")).toBeTruthy();
      cleanup();
    }
  });

  it("refuses a 51st entry in a title list", () => {
    // Only the comfort section is offered quick picks, and that is the sole
    // add path that needs no network — the watchlist's ceiling is covered by
    // the count line below.
    const onChange = vi.fn();
    render(
      <ProfileEditor
        value={{ ...DRAFT, comfortTitles: titles(50) }}
        onChange={onChange}
        quickPicks={[ARRIVAL]}
      />
    );
    const section = screen.getByRole("group", { name: /comfort/i });
    fireEvent.click(within(section).getByRole("checkbox", { name: "Arrival" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(within(section).getByText("50 is the limit — remove one first.")).toBeTruthy();
  });

  it("names the server's ceiling on every list", () => {
    // The ceiling each picker reports is its `max`. This cannot detect a
    // dropped prop — the components default to the same numbers — but it does
    // catch a picker being wired to the wrong list's ceiling, and it catches
    // the value drifting away from what the endpoint enforces.
    render(
      <ProfileEditor
        value={{
          ...DRAFT,
          comfortTitles: titles(2),
          watchlist: titles(3),
          vibes: ["Cozy"],
          dealbreakers: ["Horror"],
        }}
        onChange={vi.fn()}
      />
    );

    for (const [name, expected] of [
      [/comfort/i, "2 of 50 chosen"],
      [/watchlist/i, "3 of 50 chosen"],
      [/i want/i, "1 of 30 chosen"],
      [/dealbreakers/i, "1 of 30 chosen"],
    ] as const) {
      const section = screen.getByRole("group", { name });
      expect(within(section).getByText(expected)).toBeTruthy();
    }
  });
});
