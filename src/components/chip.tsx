// ABOUTME: Pill-shaped tag chip with checkbox semantics — selection uses the amber
// ABOUTME: border treatment (fill stays reserved for CTAs); rose tone for dealbreakers.
"use client";

import { outlinedBoundaryClasses } from "@/components/control-classes";

const IDLE = `${outlinedBoundaryClasses} bg-charcoal text-cream`;

const TONE_CLASSES = {
  amber: {
    selected: "border-amber bg-amber-glow text-amber font-medium",
    idle: IDLE,
  },
  rose: {
    selected: "border-person-b bg-[#ce7b8c20] text-person-b font-medium",
    idle: IDLE,
  },
} as const;

export interface ChipProps {
  label: string;
  selected: boolean;
  onToggle: () => void;
  tone?: keyof typeof TONE_CLASSES;
  removable?: boolean;
}

export function Chip({
  label,
  selected,
  onToggle,
  tone = "amber",
  removable = false,
}: ChipProps) {
  const toneClasses = TONE_CLASSES[tone][selected ? "selected" : "idle"];
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={label}
      onClick={onToggle}
      className={`inline-flex min-h-11 items-center gap-sm rounded-pill border px-md text-sm ${toneClasses}`}
    >
      {label}
      {removable && <span aria-hidden="true">✕</span>}
    </button>
  );
}
