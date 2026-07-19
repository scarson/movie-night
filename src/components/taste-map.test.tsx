// @vitest-environment jsdom
// ABOUTME: Tests for the taste map — per-member analysis in person colors, the overlap
// ABOUTME: zone, tension points, the never-attributing weighting line, and literal AI text.
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TasteMap, personColor, PERSON_COLORS } from "@/components/taste-map";
import type { TasteMap as TasteMapData } from "@/types/matching";

const TWO: TasteMapData = {
  members: [
    {
      userId: "u1",
      name: "Alice Chen",
      summary: "Alice reaches for precise, unsettling films that trust her to keep up.",
      primaryVibes: ["Cerebral", "Tense"],
      genreAffinities: ["Sci-Fi", "Thriller"],
    },
    {
      userId: "u2",
      name: "Bob Reyes",
      summary: "Bob wants warmth and momentum — films that are kind to their characters.",
      primaryVibes: ["Cozy", "Funny"],
      genreAffinities: ["Comedy", "Romance"],
    },
  ],
  overlap: {
    summary: "You both light up for smart films with a beating heart underneath.",
    sharedVibes: ["Witty", "Character-driven"],
    tensionPoints: [
      "Alice will sit with ambiguity longer than Bob wants to.",
      "Bob's comfort picks skew lighter than Alice's default.",
    ],
  },
};

const SOLO: TasteMapData = {
  members: [TWO.members[0]],
  overlap: {
    summary: "Your taste circles precision, and rewards films that earn their ending.",
    sharedVibes: ["Cerebral"],
    tensionPoints: [],
  },
};

describe("TasteMap", () => {
  it("renders every member's name, summary, vibes and genres", () => {
    render(<TasteMap tasteMap={TWO} showWeightingNote={false} />);

    for (const member of TWO.members) {
      const section = screen.getByRole("group", { name: member.name });
      expect(within(section).getByText(member.summary)).toBeTruthy();
      for (const tag of [...member.primaryVibes, ...member.genreAffinities]) {
        expect(within(section).getByText(tag)).toBeTruthy();
      }
    }
  });

  it("gives each member a distinct person color and a matching legend swatch", () => {
    render(<TasteMap tasteMap={TWO} showWeightingNote={false} />);

    const colors = TWO.members.map((member) => {
      const section = screen.getByRole("group", { name: member.name });
      return section.getAttribute("style") ?? "";
    });
    expect(colors[0]).toContain(personColor(0));
    expect(colors[1]).toContain(personColor(1));
    expect(personColor(0)).not.toBe(personColor(1));

    // The legend names each person, so color is reinforcement and never the sole cue.
    const legend = screen.getByRole("list", { name: /key/i });
    const entries = within(legend).getAllByRole("listitem");
    expect(entries.map((li) => li.textContent)).toEqual([
      "Alice Chen",
      "Bob Reyes",
      "Where you meet",
    ]);
  });

  it("cycles the curated color set for groups larger than the palette", () => {
    expect(PERSON_COLORS.length).toBeGreaterThanOrEqual(4);
    expect(personColor(PERSON_COLORS.length)).toBe(personColor(0));
    expect(new Set(PERSON_COLORS).size).toBe(PERSON_COLORS.length);
  });

  it("renders the overlap summary, shared vibes and every tension point", () => {
    render(<TasteMap tasteMap={TWO} showWeightingNote={false} />);

    const overlap = screen.getByRole("group", { name: /where you meet/i });
    expect(within(overlap).getByText(TWO.overlap.summary)).toBeTruthy();
    for (const vibe of TWO.overlap.sharedVibes) {
      expect(within(overlap).getByText(vibe)).toBeTruthy();
    }
    const tensions = within(overlap).getByRole("list", { name: /pulls/i });
    expect(within(tensions).getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      TWO.overlap.tensionPoints
    );
  });

  it("drops the tension list entirely when the model found none", () => {
    render(<TasteMap tasteMap={SOLO} showWeightingNote={false} />);
    expect(screen.queryByRole("list", { name: /pulls/i })).toBeNull();
  });

  it("drops the legend when there is only one person to distinguish", () => {
    render(<TasteMap tasteMap={SOLO} showWeightingNote={false} />);
    expect(screen.queryByRole("list", { name: /key/i })).toBeNull();
    expect(screen.getByRole("group", { name: /ties it together/i })).toBeTruthy();
  });

  it("shows a weighting line that names nobody and never says why", () => {
    render(<TasteMap tasteMap={TWO} showWeightingNote />);

    const note = screen.getByTestId("weighting-note");
    expect(note.textContent).toMatch(/lean/i);
    // The rough-day toggle is private: the reason is never named, and no other
    // member is ever identified as the beneficiary.
    expect(note.textContent).not.toMatch(/rough day/i);
    expect(note.textContent).not.toContain("Bob Reyes");
    expect(note.textContent).not.toContain("Alice Chen");
  });

  it("says nothing at all about weighting when the viewer set no flag", () => {
    const { container } = render(<TasteMap tasteMap={TWO} showWeightingNote={false} />);
    expect(screen.queryByTestId("weighting-note")).toBeNull();
    expect(container.textContent).not.toMatch(/rough day|lean toward|weight/i);
  });

  it("renders AI-authored text as literal characters, never as markup", () => {
    const hostile: TasteMapData = {
      members: [
        {
          ...TWO.members[0],
          summary: '<img src=x onerror="alert(1)"> &amp; <script>alert(2)</script>',
          primaryVibes: ["<b>bold</b>"],
          genreAffinities: [],
        },
      ],
      overlap: {
        summary: "<iframe src=javascript:alert(3)></iframe>",
        sharedVibes: [],
        tensionPoints: ["<svg onload=alert(4)>"],
      },
    };
    const { container } = render(<TasteMap tasteMap={hostile} showWeightingNote={false} />);

    expect(
      screen.getByText('<img src=x onerror="alert(1)"> &amp; <script>alert(2)</script>')
    ).toBeTruthy();
    expect(screen.getByText("<b>bold</b>")).toBeTruthy();
    expect(screen.getByText("<svg onload=alert(4)>")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("staggers section entrances at 80ms per DESIGN.md motion", () => {
    const { container } = render(<TasteMap tasteMap={TWO} showWeightingNote={false} />);
    const staggered = [...container.querySelectorAll<HTMLElement>(".animate-rise-fade")];
    expect(staggered.length).toBeGreaterThanOrEqual(3);
    expect(staggered.map((el) => el.style.animationDelay)).toEqual(
      staggered.map((_, i) => `${i * 80}ms`)
    );
  });
});
