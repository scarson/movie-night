// ABOUTME: Names the groups surface for 2.4.2 — the page below is a client component,
// ABOUTME: which cannot export metadata, so the title lives in this server layout.
import type { Metadata } from "next";
import { TITLE_TEMPLATE } from "@/app/title-template";

export const metadata: Metadata = {
  // The template is restated because this segment has children: a plain-string
  // title resolves against the root template but passes none down, which left
  // /groups/join/[code] rendering "Join a group" with no app name.
  title: {
    default: "Groups",
    template: TITLE_TEMPLATE,
  },
};

export default function GroupsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
