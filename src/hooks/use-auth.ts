// ABOUTME: useAuth hook — reads the AuthContext populated by AuthProvider.
// ABOUTME: Throws when used outside the provider to fail loudly on wiring mistakes.
"use client";

import { useContext } from "react";
import { AuthContext, type AuthState } from "@/components/auth-provider";

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (!state) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return state;
}
