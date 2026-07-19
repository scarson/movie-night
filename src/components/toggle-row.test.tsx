// @vitest-environment jsdom
// ABOUTME: Tests for ToggleRow — switch semantics, label/description rendering,
// ABOUTME: and change callback behavior.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToggleRow } from "@/components/toggle-row";

describe("ToggleRow", () => {
  it("exposes switch semantics named by the label", () => {
    const { rerender } = render(
      <ToggleRow label="Show us something new" checked={false} onChange={() => {}} />
    );
    const toggle = screen.getByRole("switch", { name: "Show us something new" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    rerender(
      <ToggleRow label="Show us something new" checked={true} onChange={() => {}} />
    );
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("renders the optional description", () => {
    render(
      <ToggleRow
        label="Show us something new"
        description="Skip the comfort rewatches tonight"
        checked={false}
        onChange={() => {}}
      />
    );
    expect(screen.getByText("Skip the comfort rewatches tonight")).toBeDefined();
  });

  it("reports the flipped value on activation", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ToggleRow label="Show us something new" checked={false} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(
      <ToggleRow label="Show us something new" checked={true} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});
