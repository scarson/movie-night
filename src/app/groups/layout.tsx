// ABOUTME: Names the groups surface for 2.4.2 — the page below is a client component,
// ABOUTME: which cannot export metadata, so the title lives in this server layout.
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Groups",
};

export default function GroupsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
