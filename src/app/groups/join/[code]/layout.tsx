// ABOUTME: Names the invite-accept surface for 2.4.2 — without it this page would
// ABOUTME: inherit "Groups" from the parent segment, which is not the surface you're on.
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Join a group",
};

export default function JoinGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
