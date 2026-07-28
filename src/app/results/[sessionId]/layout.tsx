// ABOUTME: Names the results surface for 2.4.2 — the page below is a client component,
// ABOUTME: which cannot export metadata, so the title lives in this server layout.
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tonight's picks",
};

export default function ResultsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
