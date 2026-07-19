// ABOUTME: The in-app "reduce animations" preference — persisted in localStorage and
// ABOUTME: expressed as data-reduced-motion on <html>, which globals.css keys off.

export const REDUCED_MOTION_KEY = "mn-reduced-motion";

const ATTRIBUTE = "data-reduced-motion";

/** The slice of Storage this needs. Injected so the unavailable case is testable. */
export interface PreferenceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * localStorage, when there is one. Privacy modes and sandboxed documents either
 * throw on access or hand back nothing at all, and both mean the same thing:
 * this preference can be honored for the session but not remembered.
 */
export function browserStore(): PreferenceStore | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

function apply(on: boolean): void {
  if (on) {
    document.documentElement.setAttribute(ATTRIBUTE, "true");
  } else {
    document.documentElement.removeAttribute(ATTRIBUTE);
  }
  for (const listener of listeners) listener();
}

/**
 * The <html> attribute is the single runtime source of truth — storage only
 * seeds it. These three make it readable from React via useSyncExternalStore,
 * which is the supported way to read browser state without setting state in an
 * effect.
 */
export function subscribeReducedMotion(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reducedMotionSnapshot(): boolean {
  return document.documentElement.getAttribute(ATTRIBUTE) === "true";
}

/** Nothing is reduced during SSR: there is no document and no stored preference. */
export function reducedMotionServerSnapshot(): boolean {
  return false;
}

export function readReducedMotion(store: PreferenceStore | null = browserStore()): boolean {
  try {
    return store?.getItem(REDUCED_MOTION_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Applies the preference immediately and tries to remember it. A storage failure
 * costs the user persistence, never the setting they just chose.
 */
export function setReducedMotion(
  on: boolean,
  store: PreferenceStore | null = browserStore()
): void {
  apply(on);
  try {
    store?.setItem(REDUCED_MOTION_KEY, on ? "true" : "false");
  } catch {
    // Nothing to do — the attribute is already set for this session.
  }
}

/** Re-applies the stored preference after a full page load. */
export function syncReducedMotion(store: PreferenceStore | null = browserStore()): void {
  apply(readReducedMotion(store));
}
