// @vitest-environment jsdom
// ABOUTME: Tests for the Chip primitive — checkbox semantics, toggle behavior,
// ABOUTME: keyboard operability via native button, and the removable affordance.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Chip } from "@/components/chip";

describe("Chip", () => {
  it("exposes checkbox semantics with aria-checked reflecting selection", () => {
    const { rerender } = render(
      <Chip label="Cozy" selected={false} onToggle={() => {}} />
    );
    const chip = screen.getByRole("checkbox", { name: "Cozy" });
    expect(chip.getAttribute("aria-checked")).toBe("false");
    rerender(<Chip label="Cozy" selected={true} onToggle={() => {}} />);
    expect(chip.getAttribute("aria-checked")).toBe("true");
  });

  it("calls onToggle when activated", () => {
    const onToggle = vi.fn();
    render(<Chip label="Cozy" selected={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Cozy" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("is a native button, so Enter/Space activate it from the keyboard", () => {
    render(<Chip label="Cozy" selected={false} onToggle={() => {}} />);
    const chip = screen.getByRole("checkbox", { name: "Cozy" });
    expect(chip.tagName).toBe("BUTTON");
    expect(chip.getAttribute("type")).toBe("button");
  });

  it("keeps the label as the accessible name when removable", () => {
    const onToggle = vi.fn();
    render(
      <Chip label="Arrival" selected={true} onToggle={onToggle} removable />
    );
    const chip = screen.getByRole("checkbox", { name: "Arrival" });
    expect(chip.textContent).toContain("✕");
    fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("accepts a rose tone without changing behavior", () => {
    render(
      <Chip label="Horror" selected={true} onToggle={() => {}} tone="rose" />
    );
    expect(
      screen.getByRole("checkbox", { name: "Horror" }).getAttribute("aria-checked")
    ).toBe("true");
  });
});
