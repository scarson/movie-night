// @vitest-environment jsdom
// ABOUTME: Tests for the **bold** marker parser — segment parsing, literal rendering
// ABOUTME: of unbalanced markers, and the no-HTML-injection guarantee for AI text.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { parseBold, BoldText } from "@/components/bold-text";

describe("parseBold", () => {
  it("returns a single plain segment for text without markers", () => {
    expect(parseBold("a quiet night in")).toEqual([
      { bold: false, text: "a quiet night in" },
    ]);
  });

  it("parses a **bold** run into plain/bold/plain segments", () => {
    expect(parseBold("Tonight, **Arrival** lands well.")).toEqual([
      { bold: false, text: "Tonight, " },
      { bold: true, text: "Arrival" },
      { bold: false, text: " lands well." },
    ]);
  });

  it("parses multiple bold runs", () => {
    expect(parseBold("**Alice** meets **Bob**")).toEqual([
      { bold: true, text: "Alice" },
      { bold: false, text: " meets " },
      { bold: true, text: "Bob" },
    ]);
  });

  it("renders an unbalanced trailing marker as literal text", () => {
    expect(parseBold("wait **for it")).toEqual([
      { bold: false, text: "wait " },
      { bold: false, text: "**for it" },
    ]);
  });

  it("returns no segments for an empty string", () => {
    expect(parseBold("")).toEqual([]);
  });

  it("drops empty segments produced by adjacent markers", () => {
    expect(parseBold("a ****b")).toEqual([
      { bold: false, text: "a " },
      { bold: false, text: "b" },
    ]);
  });
});

describe("BoldText", () => {
  it("renders bold segments as <strong>", () => {
    const { container } = render(
      <BoldText text="Tonight, **Arrival** lands well." />
    );
    const strong = container.querySelector("strong");
    expect(strong?.textContent).toBe("Arrival");
    expect(container.textContent).toBe("Tonight, Arrival lands well.");
  });

  it("renders HTML in the text as literal text, never as elements", () => {
    const payload = 'Try **this**: <img src=x onerror=alert(1)> now';
    const { container } = render(<BoldText text={payload} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe(
      "Try this: <img src=x onerror=alert(1)> now"
    );
  });

  it("renders unbalanced markers literally", () => {
    const { container } = render(<BoldText text="wait **for it" />);
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toBe("wait **for it");
  });
});
