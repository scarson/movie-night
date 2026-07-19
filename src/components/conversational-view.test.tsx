// @vitest-environment jsdom
// ABOUTME: Tests for the conversational view — paragraph splitting, **bold** titles as
// ABOUTME: real <strong> text nodes, the editorial lead line, and literal AI markup.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConversationalView } from "@/components/conversational-view";

const NOTE = [
  "Tonight leans toward the film that makes you both lean forward.",
  "**Inception** is the one Alice will want to argue about afterwards.",
  "If that feels like work, **The Dark Knight** is the easier evening.",
].join("\n");

describe("ConversationalView", () => {
  it("renders one paragraph per line, in order", () => {
    const { container } = render(<ConversationalView text={NOTE} />);
    const paragraphs = [...container.querySelectorAll("p")];
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0].textContent).toBe(
      "Tonight leans toward the film that makes you both lean forward."
    );
    expect(paragraphs[2].textContent).toBe(
      "If that feels like work, The Dark Knight is the easier evening."
    );
  });

  it("drops blank lines rather than rendering empty paragraphs", () => {
    const { container } = render(
      <ConversationalView text={"First.\n\n   \n\nSecond." } />
    );
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });

  it("turns **markers** into real emphasis, never into markup", () => {
    const { container } = render(<ConversationalView text={NOTE} />);
    const strongs = [...container.querySelectorAll("strong")];
    expect(strongs.map((el) => el.textContent)).toEqual(["Inception", "The Dark Knight"]);
    expect(container.innerHTML).not.toContain("**");
  });

  it("gives the opening line the display face, but not when it stands alone", () => {
    const { container: many } = render(<ConversationalView text={NOTE} />);
    const first = many.querySelectorAll("p")[0];
    expect(first.className).toContain("font-display");
    expect(many.querySelectorAll("p")[1].className).not.toContain("font-display");

    const { container: one } = render(<ConversationalView text="Just the one thought." />);
    expect(one.querySelectorAll("p")[0].className).not.toContain("font-display");
  });

  it("renders AI-authored narrative as literal characters", () => {
    const hostile =
      '<img src=x onerror="alert(1)"> &amp; <b>not bold</b>\n<script>alert(2)</script>';
    const { container } = render(<ConversationalView text={hostile} />);

    expect(
      screen.getByText('<img src=x onerror="alert(1)"> &amp; <b>not bold</b>')
    ).toBeTruthy();
    expect(screen.getByText("<script>alert(2)</script>")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("splits on Windows line endings too", () => {
    const { container } = render(<ConversationalView text={"First line.\r\nSecond line."} />);
    const paragraphs = [...container.querySelectorAll("p")];
    expect(paragraphs).toHaveLength(2);
    // A stray \r would ride along invisibly inside the text node.
    expect(paragraphs[0].textContent).toBe("First line.");
  });

  it("renders nothing at all when the model returned no narrative", () => {
    const { container } = render(<ConversationalView text="   " />);
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("staggers paragraph entrances at 80ms per DESIGN.md motion", () => {
    const { container } = render(<ConversationalView text={NOTE} />);
    const paragraphs = [...container.querySelectorAll<HTMLElement>("p")];
    expect(paragraphs.map((el) => el.style.animationDelay)).toEqual(["0ms", "80ms", "160ms"]);
  });
});
