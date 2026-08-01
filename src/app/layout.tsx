// ABOUTME: Root layout — fonts, dark cinematic shell, and site-wide footer.
// ABOUTME: Pages render inside a full-height column; content width convention is 680px.
import type { Metadata, Viewport } from "next";
import { fraunces, satoshi } from "@/app/fonts";
import { AuthProvider } from "@/components/auth-provider";
import { Nav } from "@/components/nav";
import { ReducedMotionBoot } from "@/components/reduced-motion-boot";
import { SiteFooter } from "@/components/site-footer";
import { SkipLink } from "@/components/skip-link";
import { SITE_NAME, TITLE_TEMPLATE } from "@/app/title-template";
import "./globals.css";

export const metadata: Metadata = {
  // 2.4.2: each route segment names its own surface and the template adds the
  // app name, so no two pages share a title. `default` covers the landing page.
  title: {
    default: SITE_NAME,
    template: TITLE_TEMPLATE,
  },
  description: "Find a movie you'll both love tonight.",
};

export const viewport: Viewport = {
  themeColor: "#0f1219",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${fraunces.variable} ${satoshi.variable}`}>
      <head>
        {/* Posters come from a third-party origin on the results page; the DNS +
            TCP + TLS handshake is otherwise paid on the LCP element itself.

            This hint carries no crossOrigin, and must not. image.tmdb.org serves
            no Access-Control-Allow-Origin, and Poster renders a bare <img src>,
            so poster requests are no-CORS. Browsers keep CORS and no-CORS
            connections in separate pools: a crossOrigin preconnect would warm a
            socket the posters can never reuse, leaving the handshake on the
            critical path — the opposite of what this hint is for.

            The origin is written out rather than imported from poster.tsx: the
            root layout should not pull in a component module for a <link>. */}
        <link rel="preconnect" href="https://image.tmdb.org" />
      </head>
      <body className="flex min-h-dvh flex-col font-body antialiased">
        <ReducedMotionBoot />
        <SkipLink />
        <AuthProvider>
          <Nav />
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </AuthProvider>
      </body>
    </html>
  );
}
