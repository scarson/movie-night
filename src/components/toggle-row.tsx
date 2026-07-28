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
        checked ? "border-amber bg-amber-glow" : "border-ash bg-charcoal"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-base font-medium text-cream">{label}</span>
        {description && (
          <span className="mt-2xs block text-sm text-ash">{description}</span>
        )}
      </span>
      {/* Knob position is the only visual carrier of on/off, so 1.4.11 wants 3:1 on
          both the track against the panel and the knob against the track. Amber
          clears it unaided when on; off needs the ash ring and an ash knob. The
          ring is inset (box-shadow) so it draws no layout box and the knob stays centered. */}
      <span
        aria-hidden="true"
        className={`relative h-6 w-11 shrink-0 rounded-pill ${
          checked ? "bg-amber" : "bg-slate ring-1 ring-inset ring-ash"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-pill ${
            checked ? "left-[22px] bg-midnight" : "left-0.5 bg-ash"
          }`}
        />
      </span>
    </button>
  );
}
