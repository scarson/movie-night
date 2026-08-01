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

  it("offers the TMDB width ladder as srcset candidates, capped at w500", () => {
    render(<Poster title="Arrival" posterPath="/abc123.jpg" />);
    const img = screen.getByRole("img", { name: "Arrival poster" });
    expect(img.getAttribute("srcset")).toBe(
      [
        "https://image.tmdb.org/t/p/w92/abc123.jpg 92w",
        "https://image.tmdb.org/t/p/w154/abc123.jpg 154w",
        "https://image.tmdb.org/t/p/w185/abc123.jpg 185w",
        "https://image.tmdb.org/t/p/w342/abc123.jpg 342w",
        "https://image.tmdb.org/t/p/w500/abc123.jpg 500w",
      ].join(", ")
    );
  });

  it("describes the picks-list column by default, in the units the grid uses", () => {
    // ranked-list.tsx sets grid-cols-[minmax(0,14rem)_1fr] sm:grid-cols-[13rem_1fr],
    // and Tailwind's sm breakpoint is 40rem.
    render(<Poster title="Arrival" posterPath="/abc123.jpg" />);
    expect(
      screen.getByRole("img", { name: "Arrival poster" }).getAttribute("sizes")
    ).toBe("(min-width: 40rem) 13rem, 14rem");
  });

  it("lets a caller with a differently-sized box describe its own", () => {
    render(
      <Poster title="Arrival" posterPath="/abc123.jpg" size="w92" sizes="2rem" />
    );
    const img = screen.getByRole("img", { name: "Arrival poster" });
    expect(img.getAttribute("sizes")).toBe("2rem");
    expect(img.getAttribute("src")).toBe("https://image.tmdb.org/t/p/w92/abc123.jpg");
    expect(img.getAttribute("srcset")).toContain(
      "https://image.tmdb.org/t/p/w92/abc123.jpg 92w"
    );
  });

  it("renders a labeled fallback box when posterPath is null", () => {
    const { container } = render(<Poster title="Arrival" posterPath={null} />);
    expect(container.querySelector("img")).toBeNull();
    const fallback = screen.getByRole("img", { name: "Arrival poster" });
    expect(fallback.getAttribute("srcset")).toBeNull();
    expect(fallback.getAttribute("sizes")).toBeNull();
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
