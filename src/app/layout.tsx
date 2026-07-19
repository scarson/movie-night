// ABOUTME: Root layout with global styles and metadata.
// ABOUTME: Placeholder shell for Phase 0 — real navigation/providers arrive in Phase 6.
import type { Metadata } from "next";
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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
