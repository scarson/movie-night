// ABOUTME: Client auth context — fetches /api/auth/me once and exposes user state
// ABOUTME: plus signIn/signOut actions to the component tree via AuthContext.
"use client";

import { createContext, useEffect, useState } from "react";

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  signIn: (returnTo?: string) => void;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

/** The Google OAuth entry point, returning the user to `returnTo` once signed in. */
export function googleSignInUrl(returnTo: string): string {
  return `/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!cancelled) {
          setUser(res.ok ? ((await res.json()) as AuthUser) : null);
        }
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = (returnTo?: string) => {
    const target = returnTo ?? window.location.pathname;
    window.location.href = googleSignInUrl(target);
  };

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
