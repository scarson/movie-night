// @vitest-environment jsdom
// ABOUTME: Tests for the taste-profile editor — section coverage, per-field draft updates
// ABOUTME: that never clobber sibling fields, and the vibes/dealbreakers separation.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  ProfileEditor,
  STREAMING_SERVICES,
  type ProfileDraft,
} from "@/components/profile-editor";

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
