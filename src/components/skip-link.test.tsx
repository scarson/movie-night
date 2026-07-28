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

  it("every main landmark carries the skip target id", () => {
    // Pages return different <main> branches for loading / error / content, and
    // any of them can be the one on screen, so the id has to be on all of them.
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
            if (!tag.includes('id="main"')) {
              offenders.push(`${path.relative(appDir, full)}: ${tag}`);
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
