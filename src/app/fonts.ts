// ABOUTME: Font loading — Fraunces (display, Google) and Satoshi (body, self-hosted).
// ABOUTME: Exposes CSS variables --font-fraunces / --font-satoshi consumed by globals.css.
import { Fraunces } from "next/font/google";
import localFont from "next/font/local";

export const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-fraunces",
});

// next/font preloads every declared face on each prerendered route. Satoshi
// italic is 43,844 bytes — 18.6% of the font payload — and the whole app renders
// it in one place, the echoed mood text. The upright face is declared alone so
// the browser synthesises an oblique there rather than preloading a second file
// across the app. Fraunces keeps both faces; both are in use throughout.
export const satoshi = localFont({
  src: [
    {
      path: "../../public/fonts/Satoshi-Variable.woff2",
      weight: "300 900",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-satoshi",
});
