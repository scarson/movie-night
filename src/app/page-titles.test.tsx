// @vitest-environment jsdom
// ABOUTME: WCAG 2.4.2 guard — every route names its own surface instead of inheriting
// ABOUTME: the generic root title, and the segment layouts that carry the name stay passthrough.
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Metadata } from "next";
import { TITLE_TEMPLATE } from "@/app/title-template";

vi.mock("next/font/google", () => ({
  Fraunces: () => ({ variable: "--font-fraunces", className: "font-fraunces" }),
}));
vi.mock("next/font/local", () => ({
  default: () => ({ variable: "--font-satoshi", className: "font-satoshi" }),
}));

/** Route segment → the title it must contribute, naming the surface a user is on. */
const SEGMENT_TITLES: [string, string][] = [
  ["tonight", "Tonight"],
  ["quick", "Quick match"],
  ["ritual", "The full ritual"],
  ["groups", "Groups"],
  ["groups/join/[code]", "Join a group"],
  ["profile", "Profile"],
  ["results/[sessionId]", "Tonight's picks"],
];

/**
 * Segments that have route segments beneath them. A title template applies only
 * to a segment's children, and a plain-string title carries none — so a segment
 * that sets a bare string leaves its *grandchildren* with no template at all.
 * Verified in-browser: /groups/join/[code] rendered "Join a group" with no suffix.
 */
const SEGMENTS_WITH_CHILDREN = ["groups"];

describe("2.4.2 Page Titled", () => {
  it("the root layout supplies a template so segments need only name themselves", async () => {
    const { metadata } = (await import("@/app/layout")) as { metadata: Metadata };
    expect(metadata.title).toEqual({
      default: "Movie Night",
      template: TITLE_TEMPLATE,
    });
  });

  it.each(SEGMENT_TITLES)("/%s is titled %s", async (segment, title) => {
    const mod = await import(`@/app/${segment}/layout`);
    const actual = (mod.metadata as Metadata).title;
    // Segments with children carry the template forward; the rest are bare strings.
    expect(typeof actual === "string" ? actual : (actual as { default: string }).default).toBe(
      title
    );
  });

  it.each(SEGMENTS_WITH_CHILDREN)(
    "/%s forwards the template so its children keep the suffix",
    async (segment) => {
      const mod = await import(`@/app/${segment}/layout`);
      expect((mod.metadata as Metadata).title).toHaveProperty("template", TITLE_TEMPLATE);
    }
  );

  it.each(SEGMENT_TITLES)(
    "the /%s layout only adds a title — it renders children untouched",
    async (segment) => {
      const mod = await import(`@/app/${segment}/layout`);
      const Layout = mod.default as (p: {
        children: React.ReactNode;
      }) => React.ReactElement;
      expect(renderToStaticMarkup(<Layout>{<p>page body</p>}</Layout>)).toBe(
        "<p>page body</p>"
      );
    }
  );

  it("titles are all distinct", () => {
    const titles = SEGMENT_TITLES.map(([, t]) => t).concat("Privacy", "Movie Night");
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("privacy names only its surface, letting the template add the suffix", async () => {
    const { metadata } = (await import("@/app/privacy/page")) as { metadata: Metadata };
    expect(metadata.title).toBe("Privacy");
  });
});
