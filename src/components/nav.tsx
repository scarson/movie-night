// ABOUTME: Top navigation bar — Fraunces italic wordmark plus auth area.
// ABOUTME: Signed out: amber sign-in link. Signed in: avatar/name menu (Profile, Sign out).
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";

export function Nav() {
  const { user, loading, signIn, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="mx-auto flex h-16 w-full max-w-[680px] items-center justify-between px-md">
      <Link
        href="/"
        className="flex min-h-11 items-center font-display text-xl font-semibold italic text-cream"
      >
        Movie Night
      </Link>

      {loading ? null : user ? (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex min-h-11 items-center gap-sm rounded-control px-sm text-sm font-medium text-cream hover:text-warm-white"
          >
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Google avatar URL; no image optimization on Workers
              <img
                src={user.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="h-7 w-7 rounded-pill"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-pill bg-charcoal text-sm text-ash"
              >
                {user.name.charAt(0)}
              </span>
            )}
            {user.name}
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-10 mt-xs w-44 rounded-panel border border-slate bg-charcoal py-sm"
            >
              <Link
                href="/profile"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex min-h-11 items-center px-md text-sm text-cream hover:bg-slate/50"
              >
                Profile
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void signOut();
                }}
                className="flex min-h-11 w-full items-center px-md text-left text-sm text-cream hover:bg-slate/50"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => signIn()}
          className="flex min-h-11 items-center text-sm font-medium text-amber hover:text-warm-white"
        >
          Sign in
        </button>
      )}
    </header>
  );
}
