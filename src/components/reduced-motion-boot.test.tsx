// @vitest-environment jsdom
// ABOUTME: Tests that the stored reduce-animations preference is re-applied to <html>
// ABOUTME: on a fresh page load, not just while the profile page happens to be mounted.
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { ReducedMotionBoot } from "@/components/reduced-motion-boot";
import { REDUCED_MOTION_KEY } from "@/lib/reduced-motion";

function installStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => map.set(key, value),
      removeItem: (key: string) => map.delete(key),
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    },
    configurable: true,
  });
}

const attr = () => document.documentElement.getAttribute("data-reduced-motion");

beforeEach(() => {
  document.documentElement.removeAttribute("data-reduced-motion");
});

describe("ReducedMotionBoot", () => {
  it("re-applies a stored preference so it outlives a reload", () => {
    installStorage({ [REDUCED_MOTION_KEY]: "true" });
    render(<ReducedMotionBoot />);
    expect(attr()).toBe("true");
  });

  it("leaves the document untouched when the preference is off", () => {
    installStorage({ [REDUCED_MOTION_KEY]: "false" });
    render(<ReducedMotionBoot />);
    expect(attr()).toBeNull();
  });

  it("renders nothing of its own", () => {
    installStorage();
    const { container } = render(<ReducedMotionBoot />);
    expect(container.innerHTML).toBe("");
  });
});
