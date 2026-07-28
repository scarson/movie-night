// @vitest-environment jsdom
// ABOUTME: Tests for the site footer — TMDB/JustWatch attribution and privacy link.
// ABOUTME: Attribution strings are required by TMDB API terms and JustWatch data licensing.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteFooter } from "@/components/site-footer";

describe("SiteFooter", () => {
  it("shows the TMDB attribution notice", () => {
    render(<SiteFooter />);
    expect(
      screen.getByText(
        "This product uses the TMDB API but is not endorsed or certified by TMDB."
      )
    ).toBeDefined();
  });

  it("shows the JustWatch attribution notice", () => {
    render(<SiteFooter />);
    expect(screen.getByText("Streaming data by JustWatch")).toBeDefined();
  });

  it("links to the privacy policy", () => {
    render(<SiteFooter />);
    const link = screen.getByRole("link", { name: "Privacy" });
    expect(link.getAttribute("href")).toBe("/privacy");
  });
});
