// @vitest-environment jsdom
// ABOUTME: Tests for RoughDayToggle — the private care toggle: switch semantics,
// ABOUTME: partner-name copy, and the outline→filled amber heart.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RoughDayToggle } from "@/components/rough-day-toggle";

describe("RoughDayToggle", () => {
  it("names the switch with the partner's rough-day line", () => {
    render(<RoughDayToggle name="Alice" checked={false} onChange={() => {}} />);
    const toggle = screen.getByRole("switch", {
      name: /Alice had a rough day/,
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(
      screen.getByText("Prioritize their preferences over mine tonight")
    ).toBeDefined();
  });

  it("shows an outline heart when off and a filled amber heart when on", () => {
    const { container, rerender } = render(
      <RoughDayToggle name="Alice" checked={false} onChange={() => {}} />
    );
    const heartPath = () => container.querySelector("svg path");
    expect(heartPath()?.getAttribute("fill")).toBe("none");
    rerender(<RoughDayToggle name="Alice" checked={true} onChange={() => {}} />);
    expect(heartPath()?.getAttribute("fill")).toBe("var(--amber)");
    expect(heartPath()?.getAttribute("stroke-width")).toBe("1.5");
  });

  it("reports the flipped value on activation", () => {
    const onChange = vi.fn();
    render(<RoughDayToggle name="Alice" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("tells the owner the toggle is private", () => {
    render(<RoughDayToggle name="Alice" checked={false} onChange={() => {}} />);
    expect(screen.getByText("Only you can see this.")).toBeDefined();
  });
});
