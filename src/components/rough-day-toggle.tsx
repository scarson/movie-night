// ABOUTME: The private care toggle — "«name» had a rough day". Heart goes from
// ABOUTME: outline to filled amber. Only the person setting it ever sees it.
"use client";

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      className="shrink-0"
    >
      <path
        d="M12 20.5C7 16.5 3.5 13.1 3.5 9.4 3.5 6.7 5.6 4.5 8.2 4.5c1.5 0 3 .7 3.8 1.9.8-1.2 2.3-1.9 3.8-1.9 2.6 0 4.7 2.2 4.7 4.9 0 3.7-3.5 7.1-8.5 11.1Z"
        fill={filled ? "var(--amber)" : "none"}
        stroke="var(--amber)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface RoughDayToggleProps {
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function RoughDayToggle({ name, checked, onChange }: RoughDayToggleProps) {
  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`${name} had a rough day`}
        onClick={() => onChange(!checked)}
        className={`flex w-full items-center gap-md rounded-panel border p-md text-left ${
          checked ? "border-amber bg-amber-glow" : "border-ash bg-charcoal"
        }`}
      >
        <Heart filled={checked} />
        <span className="min-w-0">
          <span
            className={`block text-base font-medium ${
              checked ? "text-amber" : "text-cream"
            }`}
          >
            {name} had a rough day
          </span>
          <span className="mt-2xs block text-sm text-ash">
            Prioritize their preferences over mine tonight
          </span>
        </span>
      </button>
      <p className="mt-xs text-sm text-ash">Only you can see this.</p>
    </div>
  );
}
