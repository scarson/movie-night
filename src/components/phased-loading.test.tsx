// @vitest-environment jsdom
// ABOUTME: Tests for PhasedLoading — 900ms phase holds while waiting, 200ms
// ABOUTME: fast-forward once done, ≈1.5s narrative minimum, aria-live politeness.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { PhasedLoading } from "@/components/phased-loading";

const PHASES = [
  "Reading your tastes...",
  "Finding the overlap...",
  "Weighing tonight's mood...",
  "Choosing tonight's picks...",
];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("PhasedLoading", () => {
  it("announces phases politely and shows the first phase immediately", () => {
    render(<PhasedLoading done={false} />);
    const region = screen.getByText(PHASES[0]).closest("[aria-live]");
    expect(region?.getAttribute("aria-live")).toBe("polite");
  });

  it("advances every 900ms while waiting and holds on the last phase", () => {
    render(<PhasedLoading done={false} />);
    expect(screen.getByText(PHASES[0])).toBeDefined();
    advance(899);
    expect(screen.getByText(PHASES[0])).toBeDefined();
    advance(1);
    expect(screen.getByText(PHASES[1])).toBeDefined();
    advance(900);
    expect(screen.getByText(PHASES[2])).toBeDefined();
    advance(900);
    expect(screen.getByText(PHASES[3])).toBeDefined();
    advance(5000);
    expect(screen.getByText(PHASES[3])).toBeDefined();
  });

  it("lands the whole narrative in ≈1.5s when the response is already there", () => {
    const onComplete = vi.fn();
    render(<PhasedLoading done={true} onComplete={onComplete} />);
    expect(screen.getByText(PHASES[0])).toBeDefined();
    advance(900);
    expect(screen.getByText(PHASES[1])).toBeDefined();
    advance(200);
    expect(screen.getByText(PHASES[2])).toBeDefined();
    advance(200);
    expect(screen.getByText(PHASES[3])).toBeDefined();
    expect(onComplete).not.toHaveBeenCalled();
    advance(200);
    expect(onComplete).toHaveBeenCalledTimes(1);
    advance(2000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("finishes the current 900ms hold, then fast-forwards at 200ms per phase", () => {
    const onComplete = vi.fn();
    const { rerender } = render(
      <PhasedLoading done={false} onComplete={onComplete} />
    );
    advance(900);
    expect(screen.getByText(PHASES[1])).toBeDefined();
    rerender(<PhasedLoading done={true} onComplete={onComplete} />);
    advance(899);
    expect(screen.getByText(PHASES[1])).toBeDefined();
    advance(1);
    expect(screen.getByText(PHASES[2])).toBeDefined();
    advance(200);
    expect(screen.getByText(PHASES[3])).toBeDefined();
    advance(200);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("completes immediately when done arrives during the last-phase hold", () => {
    const onComplete = vi.fn();
    const { rerender } = render(
      <PhasedLoading done={false} onComplete={onComplete} />
    );
    advance(900);
    advance(900);
    advance(900);
    advance(900);
    expect(screen.getByText(PHASES[3])).toBeDefined();
    expect(onComplete).not.toHaveBeenCalled();
    rerender(<PhasedLoading done={true} onComplete={onComplete} />);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("accepts custom phases", () => {
    render(<PhasedLoading done={false} phases={["One...", "Two..."]} />);
    expect(screen.getByText("One...")).toBeDefined();
    advance(900);
    expect(screen.getByText("Two...")).toBeDefined();
  });
});
