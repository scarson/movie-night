// ABOUTME: Tests for the root layout — html lang, font variables, and footer wiring.
// ABOUTME: Uses renderToStaticMarkup (layout renders <html>, which jsdom containers reject).
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// next/font runs a build-time loader that is unavailable under vitest; these
// stubs stand in for the loader only — the layout markup under test is real.
vi.mock("next/font/google", () => ({
  Fraunces: () => ({ variable: "--font-fraunces", className: "font-fraunces" }),
}));
vi.mock("next/font/local", () => ({
  default: () => ({ variable: "--font-satoshi", className: "font-satoshi" }),
}));

import RootLayout from "@/app/layout";

describe("RootLayout", () => {
  const markup = renderToStaticMarkup(
    <RootLayout>
      <p>page content</p>
    </RootLayout>
  );

  it("sets the document language", () => {
    expect(markup).toContain('lang="en"');
  });

  it("attaches both font CSS variables", () => {
    expect(markup).toContain("--font-fraunces");
    expect(markup).toContain("--font-satoshi");
  });

  it("renders page content inside the layout", () => {
    expect(markup).toContain("page content");
  });

  it("renders the footer attribution", () => {
    expect(markup).toContain(
      "This product uses the TMDB API but is not endorsed or certified by TMDB."
    );
    expect(markup).toContain("Streaming data by JustWatch");
  });
});
