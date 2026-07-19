// @vitest-environment jsdom
// ABOUTME: Tests for Poster — TMDB image URL construction, lazy loading, alt text,
// ABOUTME: and the quiet charcoal fallback when no poster path exists.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Poster } from "@/components/poster";

describe("Poster", () => {
  it("renders a lazy TMDB image with '<title> poster' alt text", () => {
    render(<Poster title="Arrival" posterPath="/abc123.jpg" />);
    const img = screen.getByRole("img", { name: "Arrival poster" });
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe(
      "https://image.tmdb.org/t/p/w342/abc123.jpg"
    );
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("supports smaller TMDB sizes", () => {
    render(<Poster title="Arrival" posterPath="/abc123.jpg" size="w92" />);
    expect(
      screen.getByRole("img", { name: "Arrival poster" }).getAttribute("src")
    ).toBe("https://image.tmdb.org/t/p/w92/abc123.jpg");
  });

  it("renders a labeled fallback box when posterPath is null", () => {
    const { container } = render(<Poster title="Arrival" posterPath={null} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "Arrival poster" })).toBeDefined();
  });
});
