// @vitest-environment jsdom
// ABOUTME: Tests for the ritual stepper indicator — current-step marking, backward
// ABOUTME: navigation from completed steps only, and label availability to screen readers.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProgressSteps } from "@/components/progress-steps";

const STEPS = ["Alice", "Bob", "Mood"];

describe("ProgressSteps", () => {
  it("renders every step label and marks only the current one", () => {
    render(<ProgressSteps steps={STEPS} current={1} onStepSelect={vi.fn()} />);

    for (const label of STEPS) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    const currents = document.querySelectorAll('[aria-current="step"]');
    expect(currents).toHaveLength(1);
    expect(currents[0].textContent).toContain("Bob");
  });

  it("makes completed steps activatable and reports the index", () => {
    const onStepSelect = vi.fn();
    render(<ProgressSteps steps={STEPS} current={2} onStepSelect={onStepSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /Alice/ }));
    expect(onStepSelect).toHaveBeenCalledWith(0);
  });

  it("offers no control for the current or upcoming steps", () => {
    render(<ProgressSteps steps={STEPS} current={1} onStepSelect={vi.fn()} />);

    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names.some((n) => n?.includes("Alice"))).toBe(true);
    expect(names.some((n) => n?.includes("Bob"))).toBe(false);
    expect(names.some((n) => n?.includes("Mood"))).toBe(false);
  });

  it("names each control with its step position so the list reads unambiguously", () => {
    render(<ProgressSteps steps={STEPS} current={2} onStepSelect={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Step 1: Alice" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Step 2: Bob" })).toBeTruthy();
  });

  it("exposes progress as an ordered list under a labelled landmark", () => {
    render(<ProgressSteps steps={STEPS} current={0} onStepSelect={vi.fn()} />);

    const nav = screen.getByRole("navigation", { name: /progress/i });
    expect(nav.querySelectorAll("ol > li")).toHaveLength(3);
  });
});
