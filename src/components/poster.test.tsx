// @vitest-environment jsdom
// ABOUTME: Tests for Poster — TMDB image URL construction, lazy vs priority loading,
// ABOUTME: alt text, and the quiet charcoal fallback when no poster path exists.
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

  it("is lazy by default, so a flipped default fails here", () => {
    render(<Poster title="Arrival" posterPath="/abc123.jpg" />);
    const img = screen.getByRole("img", { name: "Arrival poster" });
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("fetchpriority")).toBeNull();
  });

  it("loads a priority poster eagerly at high fetch priority", () => {
    render(<Poster title="Arrival" posterPath="/abc123.jpg" priority />);
    const img = screen.getByRole("img", { name: "Arrival poster" });
    expect(img.getAttribute("loading")).toBe("eager");
    expect(img.getAttribute("fetchpriority")).toBe("high");
  });

  it("decodes asynchronously whether or not it is priority", () => {
    const { unmount } = render(<Poster title="Arrival" posterPath="/abc123.jpg" />);
    expect(
      screen.getByRole("img", { name: "Arrival poster" }).getAttribute("decoding")
    ).toBe("async");
    unmount();
    render(<Poster title="Arrival" posterPath="/abc123.jpg" priority />);
    expect(
      screen.getByRole("img", { name: "Arrival poster" }).getAttribute("decoding")
    ).toBe("async");
  });

  it("renders a labeled fallback box when posterPath is null", () => {
    const { container } = render(<Poster title="Arrival" posterPath={null} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "Arrival poster" })).toBeDefined();
  });

  it("renders the same fallback box for a priority poster with no path", () => {
    const { container } = render(
      <Poster title="Arrival" posterPath={null} priority />
    );
    expect(container.querySelector("img")).toBeNull();
    const fallback = screen.getByRole("img", { name: "Arrival poster" });
    expect(fallback.tagName).toBe("DIV");
    expect(fallback.getAttribute("loading")).toBeNull();
    expect(fallback.getAttribute("fetchpriority")).toBeNull();
  });
});
