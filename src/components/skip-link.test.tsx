// @vitest-environment jsdom
// ABOUTME: WCAG 2.4.1 guard — a skip link is the first focusable thing on the page,
// ABOUTME: it stays invisible until focused, and every <main> branch answers to #main.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { SkipLink } from "@/components/skip-link";

vi.mock("next/font/google", () => ({
  Fraunces: () => ({ variable: "--font-fraunces", className: "font-fraunces" }),
}));
vi.mock("next/font/local", () => ({
  default: () => ({ variable: "--font-satoshi", className: "font-satoshi" }),
}));

describe("SkipLink", () => {
  it("points at the main landmark", () => {
    render(<SkipLink />);
    expect(screen.getByRole("link", { name: /skip to content/i })).toHaveProperty(
      "hash",
      "#main"
    );
  });

  it("is hidden until focused, then visible", () => {
    render(<SkipLink />);
    const link = screen.getByRole("link", { name: /skip to content/i });
    // sr-only keeps it out of the visual design; focus:not-sr-only brings it back
    // for keyboard users. Both halves are required — sr-only alone would make the
    // link unreachable in practice, and dropping it would put it in the layout.
    expect(link.className).toContain("sr-only");
    expect(link.className).toContain("focus:not-sr-only");
  });

  it("carries its padding in the focus variant", () => {
    // `not-sr-only` resets padding to 0, so an unprefixed `px-*` loses the cascade
    // and the focused link renders with its text jammed against the border.
    // Measured in a real browser before this was prefixed: padding 0 on all sides.
    render(<SkipLink />);
    const link = screen.getByRole("link", { name: /skip to content/i });
    const padding = link.className
      .split(/\s+/)
      .filter((c) => /(^|:)p[xy]?-/.test(c));
    expect(padding.length, "no padding utilities at all").toBeGreaterThan(0);
    for (const cls of padding) {
      expect(cls, `${cls} is reset by not-sr-only`).toMatch(/^focus:/);
    }
  });
});

describe("2.4.1 Bypass Blocks", () => {
  it("the skip link precedes the repeated banner in the root layout", async () => {
    const { default: RootLayout } = await import("@/app/layout");
    const markup = renderToStaticMarkup(
      <RootLayout>
        <p>page content</p>
      </RootLayout>
    );
    // Nav renders a <header> (banner landmark), and that is the block being
    // bypassed — the skip link has to come before it to be the first tab stop.
    const skip = markup.indexOf('href="#main"');
    const banner = markup.indexOf("<header");
    expect(skip, "no skip link in the root layout").toBeGreaterThan(-1);
    expect(banner, "no banner in the root layout").toBeGreaterThan(-1);
    expect(skip).toBeLessThan(banner);
  });

  it("every main landmark is a focusable skip target", () => {
    // Pages return different <main> branches for loading / error / content, and
    // any of them can be the one on screen, so both attributes go on all of them.
    //
    // tabIndex={-1} is load-bearing, not belt-and-braces: a bare `<main id="main">`
    // is not focusable, so activating the link scrolls but leaves activeElement on
    // <body> — the next Tab returns to the banner the user just asked to skip.
    // Verified in a real browser; jsdom cannot exercise fragment-navigation focus,
    // so this scan is what holds the line.
    const appDir = path.resolve(__dirname, "..", "app");
    const offenders: string[] = [];
    let total = 0;

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
          const src = readFileSync(full, "utf8");
          for (const [tag] of src.matchAll(/<main[^>]*>/g)) {
            total++;
            const missing = [
              tag.includes('id="main"') ? null : 'id="main"',
              tag.includes("tabIndex={-1}") ? null : "tabIndex={-1}",
            ].filter(Boolean);
            if (missing.length) {
              offenders.push(
                `${path.relative(appDir, full)} missing ${missing.join(" + ")}: ${tag}`
              );
            }
          }
        }
      }
    };
    walk(appDir);

    expect(total, "no <main> elements found — did the scan break?").toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
