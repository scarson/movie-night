// ABOUTME: Root layout — fonts, dark cinematic shell, and site-wide footer.
// ABOUTME: Pages render inside a full-height column; content width convention is 680px.
import type { Metadata } from "next";
import { fraunces, satoshi } from "@/app/fonts";
import { AuthProvider } from "@/components/auth-provider";
import { Nav } from "@/components/nav";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "Movie Night",
  description: "Find a movie you'll both love tonight.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${fraunces.variable} ${satoshi.variable}`}>
      <body className="flex min-h-dvh flex-col font-body antialiased">
        <AuthProvider>
          <Nav />
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </AuthProvider>
      </body>
    </html>
  );
}
