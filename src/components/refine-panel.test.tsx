// @vitest-environment jsdom
// ABOUTME: Tests for the refine panel — kept/removed counts, the steering note, the four
// ABOUTME: context-sensitive button labels, the round counter and the round ceiling.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RefinePanel, refineButtonLabel } from "@/components/refine-panel";

const BASE = {
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

const regenerate = () => screen.getByTestId("regenerate");

describe("refineButtonLabel", () => {
  it("names exactly what the next round will be built from", () => {
    expect(refineButtonLabel(false, false)).toBe("Show me different options →");
    expect(refineButtonLabel(true, false)).toBe("Regenerate with ratings →");
    expect(refineButtonLabel(false, true)).toBe("Regenerate with feedback →");
    expect(refineButtonLabel(true, true)).toBe("Regenerate with ratings + feedback →");
  });
});

describe("RefinePanel", () => {
  it("switches the CTA label as ratings and feedback arrive", () => {
    const { rerender } = render(<RefinePanel {...BASE} />);
    expect(regenerate().textContent).toBe("Show me different options →");

    rerender(<RefinePanel {...BASE} keptCount={2} />);
    expect(regenerate().textContent).toBe("Regenerate with ratings →");

    rerender(<RefinePanel {...BASE} steering="something lighter" />);
    expect(regenerate().textContent).toBe("Regenerate with feedback →");

    rerender(<RefinePanel {...BASE} removedCount={1} steering="something lighter" />);
    expect(regenerate().textContent).toBe("Regenerate with ratings + feedback →");
  });

  it("treats whitespace-only feedback as no feedback", () => {
    render(<RefinePanel {...BASE} steering="   " />);
    expect(regenerate().textContent).toBe("Show me different options →");
  });

  it("shows kept and removed counts only once there are any", () => {
    const { rerender } = render(<RefinePanel {...BASE} />);
    expect(screen.queryByText(/kept/i)).toBeNull();
    expect(screen.queryByText(/removed/i)).toBeNull();

    rerender(<RefinePanel {...BASE} keptCount={2} removedCount={1} />);
    expect(screen.getByText("2 kept")).toBeTruthy();
    expect(screen.getByText("1 removed")).toBeTruthy();
  });

  it("accounts for picks removed in earlier rounds", () => {
    render(<RefinePanel {...BASE} round={3} removedCount={1} carriedRemovedCount={4} />);
    expect(screen.getByText("+ 4 from earlier rounds")).toBeTruthy();
  });

  it("says which round this is out of the budget", () => {
    render(<RefinePanel {...BASE} round={3} />);
    expect(screen.getByText("Round 3 of 10")).toBeTruthy();
  });

  it("caps the steering note at 300 characters and counts them live", () => {
    const onSteeringChange = vi.fn();
    render(<RefinePanel {...BASE} steering="abc" onSteeringChange={onSteeringChange} />);

    const note = screen.getByRole("textbox", { name: /anything else/i });
    expect(note.getAttribute("maxlength")).toBe("300");
    // ≥16px, or iOS zooms the page on focus.
    expect(note.className).toContain("text-base");
    expect(screen.getByText("3/300")).toBeTruthy();

    fireEvent.change(note, { target: { value: "abcd" } });
    expect(onSteeringChange).toHaveBeenCalledWith("abcd");
  });

  it("runs the next round and can start the evening over", () => {
    const onRegenerate = vi.fn();
    const onStartOver = vi.fn();
    render(<RefinePanel {...BASE} onRegenerate={onRegenerate} onStartOver={onStartOver} />);

    fireEvent.click(regenerate());
    expect(onRegenerate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /start over/i }));
    expect(onStartOver).toHaveBeenCalledTimes(1);
  });

  it("closes refinement at the round ceiling and explains why", () => {
    const onRegenerate = vi.fn();
    render(<RefinePanel {...BASE} round={10} onRegenerate={onRegenerate} />);

    expect(regenerate().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/last round of the night/i)).toBeTruthy();
    fireEvent.click(regenerate());
    expect(onRegenerate).not.toHaveBeenCalled();
    // Starting over is the way out, so it must stay live.
    expect(screen.getByRole("button", { name: /start over/i }).hasAttribute("disabled")).toBe(
      false
    );
  });

  it("stands down while a round is already running", () => {
    const onRegenerate = vi.fn();
    render(<RefinePanel {...BASE} busy onRegenerate={onRegenerate} />);
    expect(regenerate().hasAttribute("disabled")).toBe(true);
    fireEvent.click(regenerate());
    expect(onRegenerate).not.toHaveBeenCalled();
  });
});
