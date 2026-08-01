// @vitest-environment jsdom
// ABOUTME: Tests for clippingUtilities — the denylist backing both 1.4.10 guards,
// ABOUTME: where a regex typo would leave those guards vacuous and still green.
import { describe, it, expect } from "vitest";
import { clippingUtilities } from "@/test/clipping";

function span(className: string): Element {
  const el = document.createElement("span");
  el.className = className;
  return el;
}

describe("clippingUtilities", () => {
  it("reports nothing for a wrapping element", () => {
    expect(clippingUtilities(span("mt-2xs block break-words text-sm text-ash"))).toEqual([]);
    expect(clippingUtilities(span("min-w-0 flex-1 break-all rounded-control"))).toEqual([]);
    expect(clippingUtilities(span(""))).toEqual([]);
  });

  // Each of these is a way the same clipping walks back in. They are listed
  // one per line so a dropped pattern fails on the name that was dropped.
  it.each([
    "truncate",
    "text-ellipsis",
    "overflow-hidden",
    "overflow-x-hidden",
    "overflow-y-hidden",
    "overflow-clip",
    "overflow-x-clip",
    "overflow-y-clip",
    "whitespace-nowrap",
    "whitespace-pre",
    "text-nowrap",
    "line-clamp-1",
    "line-clamp-2",
    "line-clamp-6",
  ])("reports %s", (utility) => {
    expect(clippingUtilities(span(`block ${utility} text-sm`))).toEqual([utility]);
  });

  it("reports every clipping utility present, not just the first", () => {
    expect(
      clippingUtilities(span("block overflow-hidden text-ellipsis whitespace-nowrap"))
    ).toEqual(["overflow-hidden", "text-ellipsis", "whitespace-nowrap"]);
  });

  // These wrap. Listing them as clipping would push callers toward a utility
  // that clips, so the false-positive direction matters as much as the other.
  it.each([
    "whitespace-pre-wrap",
    "whitespace-pre-line",
    "whitespace-normal",
    "break-words",
    "break-all",
    "overflow-visible",
    "overflow-auto",
    "text-wrap",
    "text-clip",
  ])("does not report %s", (utility) => {
    expect(clippingUtilities(span(`block ${utility} text-sm`))).toEqual([]);
  });

  it("reads an SVG element's classes without throwing", () => {
    // SVGElement.className is an SVGAnimatedString, not a string — splitting it
    // is a TypeError, so the implementation goes through classList.
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "block truncate");
    expect(clippingUtilities(svg)).toEqual(["truncate"]);
  });
});
