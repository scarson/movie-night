// ABOUTME: Root layout — fonts, dark cinematic shell, and site-wide footer.
// ABOUTME: Pages render inside a full-height column; content width convention is 680px.
import type { Metadata, Viewport } from "next";
import { fraunces, satoshi } from "@/app/fonts";
import { AuthProvider } from "@/components/auth-provider";
import { Nav } from "@/components/nav";
import { ReducedMotionBoot } from "@/components/reduced-motion-boot";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

export const metadata: Metadata = {
  // 2.4.2: each route segment names its own surface and the template adds the
  // app name, so no two pages share a title. `default` covers the landing page.
  title: {
    default: "Movie Night",
    template: "%s — Movie Night",
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
      <body className="flex min-h-dvh flex-col font-body antialiased">
        <ReducedMotionBoot />
        <AuthProvider>
          <Nav />
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </AuthProvider>
      </body>
    </html>
  );
}
