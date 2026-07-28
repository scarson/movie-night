// ABOUTME: Re-applies the stored reduce-animations preference to <html> after a full
// ABOUTME: page load, so the profile toggle survives more than the current SPA session.
"use client";

import { useEffect } from "react";
import { syncReducedMotion } from "@/lib/reduced-motion";

/**
 * Runs on hydration rather than before first paint: reading localStorage that
 * early would mean injecting an inline script, and `dangerouslySetInnerHTML` is
 * banned repo-wide. The cost is that an entrance already in flight is cut short
 * on the first render after a hard reload — one frame, on one navigation.
 */
export function ReducedMotionBoot() {
  useEffect(() => {
    syncReducedMotion();
  }, []);
  return null;
}
