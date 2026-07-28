// @vitest-environment jsdom
// ABOUTME: Tests for the in-app reduce-animations preference — persistence, the
// ABOUTME: <html> attribute globals.css keys off, and storage that refuses to work.
import { describe, it, expect, beforeEach } from "vitest";
import {
  REDUCED_MOTION_KEY,
  readReducedMotion,
  setReducedMotion,
  syncReducedMotion,
  type PreferenceStore,
} from "@/lib/reduced-motion";

const attr = () => document.documentElement.getAttribute("data-reduced-motion");

function memoryStore(initial: Record<string, string> = {}): PreferenceStore {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

const throwingStore: PreferenceStore = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
};

beforeEach(() => {
  document.documentElement.removeAttribute("data-reduced-motion");
});

describe("reduced motion preference", () => {
  it("is off until someone turns it on", () => {
    expect(readReducedMotion(memoryStore())).toBe(false);
  });

  it("persists the choice and marks the document for globals.css", () => {
    const store = memoryStore();
    setReducedMotion(true, store);

    expect(store.getItem(REDUCED_MOTION_KEY)).toBe("true");
    // globals.css selects on [data-reduced-motion="true"] specifically.
    expect(attr()).toBe("true");
    expect(readReducedMotion(store)).toBe(true);
  });

  it("removes the attribute rather than setting it false", () => {
    const store = memoryStore();
    setReducedMotion(true, store);
    setReducedMotion(false, store);

    expect(attr()).toBeNull();
    expect(readReducedMotion(store)).toBe(false);
  });

  it("restores the stored choice on a fresh page load", () => {
    syncReducedMotion(memoryStore({ [REDUCED_MOTION_KEY]: "true" }));
    expect(attr()).toBe("true");
  });

  it("leaves the document alone when nothing was ever stored", () => {
    syncReducedMotion(memoryStore());
    expect(attr()).toBeNull();
  });

  it("survives storage that throws, as in private browsing", () => {
    expect(readReducedMotion(throwingStore)).toBe(false);
    expect(() => setReducedMotion(true, throwingStore)).not.toThrow();
    // The preference still applies for this session even if it cannot be saved.
    expect(attr()).toBe("true");
  });

  it("survives having no storage at all", () => {
    expect(readReducedMotion(null)).toBe(false);
    expect(() => setReducedMotion(true, null)).not.toThrow();
    expect(attr()).toBe("true");
    expect(() => syncReducedMotion(null)).not.toThrow();
    expect(attr()).toBeNull();
  });
});
