// ABOUTME: The ritual's step indicator — a numbered rail of member steps then Mood,
// ABOUTME: where completed steps are the only ones you can jump back to.
"use client";

export interface ProgressStepsProps {
  steps: string[];
  current: number;
  onStepSelect: (index: number) => void;
}

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 12.5 10 17.5 19 7"
        stroke="var(--amber)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Amber fill is reserved for CTAs (DESIGN.md's three-level hierarchy), so the
// current step is marked with the border-and-glow "active state" treatment.
function Marker({ state, position }: { state: "done" | "current" | "upcoming"; position: number }) {
  const base =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-pill border text-sm tabular-nums";
  const tone =
    state === "current"
      ? "border-amber bg-amber-glow font-semibold text-amber"
      : state === "done"
        ? "border-amber text-amber"
        : "border-slate text-ash";
  return (
    <span aria-hidden="true" className={`${base} ${tone}`}>
      {state === "done" ? <Check /> : position}
    </span>
  );
}

export function ProgressSteps({ steps, current, onStepSelect }: ProgressStepsProps) {
  return (
    <nav aria-label="Ritual progress">
      <ol className="flex items-center gap-2xs">
        {steps.map((label, index) => {
          const state = index < current ? "done" : index === current ? "current" : "upcoming";
          // Labels stay in the accessibility tree at every width; below 640px only
          // the current one is painted, so a long member name can't force h-scroll.
          const labelClasses = `truncate text-sm ${
            state === "current"
              ? "font-medium text-cream"
              : "sr-only sm:not-sr-only sm:text-ash"
          }`;

          return (
            <li key={`${label}-${index}`} className="flex min-w-0 items-center gap-2xs">
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className={`h-px w-4 shrink-0 sm:w-6 ${index <= current ? "bg-amber" : "bg-slate"}`}
                />
              )}
              {state === "done" ? (
                <button
                  type="button"
                  onClick={() => onStepSelect(index)}
                  aria-label={`Step ${index + 1}: ${label}`}
                  // `min-w-11` because the label is `sr-only` below `sm:`, which
                  // leaves the 28px marker as the whole target. It replaces a
                  // `min-w-0` that only ever mattered at `sm:` and up, where the
                  // label paints and has to be allowed to truncate — below that
                  // width `sr-only` is what keeps a long name out of the layout.
                  // Both are explicit minimums, so the button still shrinks past
                  // its content either way; this one stops at a thumb.
                  className="flex min-h-11 min-w-11 items-center justify-center gap-xs rounded-control px-2xs"
                >
                  <Marker state={state} position={index + 1} />
                  <span className={labelClasses}>{label}</span>
                </button>
              ) : (
                <span
                  {...(state === "current" ? { "aria-current": "step" as const } : {})}
                  className="flex min-h-11 min-w-0 items-center gap-xs px-2xs"
                >
                  <Marker state={state} position={index + 1} />
                  <span className={labelClasses}>{label}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
