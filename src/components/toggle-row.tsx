// ABOUTME: Labeled switch row — text on the left, track-and-knob toggle on the
// ABOUTME: right. Utility action, so state changes are instant (no animation).
"use client";

export interface ToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-md rounded-panel border p-md text-left ${
        checked ? "border-amber bg-amber-glow" : "border-slate bg-charcoal"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-base font-medium text-cream">{label}</span>
        {description && (
          <span className="mt-2xs block text-sm text-ash">{description}</span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={`relative h-6 w-11 shrink-0 rounded-pill ${
          checked ? "bg-amber" : "bg-slate"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-pill bg-midnight ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
