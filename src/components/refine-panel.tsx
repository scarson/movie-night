// ABOUTME: The refinement controls — what you kept and removed, an optional steering
// ABOUTME: note, the round budget, and a CTA that names what the next round is built from.
"use client";

import { useId } from "react";
import { primaryButtonClasses, secondaryButtonClasses } from "@/components/control-classes";

const MAX_STEERING = 300;

/** The exact four labels: the button always says what it is about to use. */
export function refineButtonLabel(hasRatings: boolean, hasFeedback: boolean): string {
  if (hasRatings && hasFeedback) return "Regenerate with ratings + feedback →";
  if (hasRatings) return "Regenerate with ratings →";
  if (hasFeedback) return "Regenerate with feedback →";
  return "Show me different options →";
}

export interface RefinePanelProps {
  round: number;
  maxRounds: number;
  keptCount: number;
  removedCount: number;
  /** Picks removed in earlier rounds — still excluded, but not re-listed above. */
  carriedRemovedCount: number;
  steering: string;
  onSteeringChange: (text: string) => void;
  onRegenerate: () => void;
  onStartOver: () => void;
  busy?: boolean;
  /**
   * The server rejected the last round for hitting the limit. The round number
   * only advances on success, so it cannot be inferred from the count alone.
   */
  exhausted?: boolean;
}

export function RefinePanel({
  round,
  maxRounds,
  keptCount,
  removedCount,
  carriedRemovedCount,
  steering,
  onSteeringChange,
  onRegenerate,
  onStartOver,
  busy = false,
  exhausted = false,
}: RefinePanelProps) {
  const headingId = useId();
  const noteId = useId();

  const hasRatings = keptCount > 0 || removedCount > 0;
  const hasFeedback = steering.trim() !== "";
  const spent = round >= maxRounds || exhausted;

  return (
    <section
      aria-labelledby={headingId}
      className="mt-3xl rounded-panel border border-slate bg-charcoal p-lg"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <h2 id={headingId} className="font-display text-xl font-semibold text-warm-white">
          Not quite it?
        </h2>
        <p className="text-xs tabular-nums text-ash">{`Round ${round} of ${maxRounds}`}</p>
      </div>

      <p className="mt-2xs max-w-[62ch] text-sm text-ash">
        {hasRatings
          ? "We'll keep what you liked, drop what you didn't, and fill the gaps with something new."
          : "Keep or remove individual picks above, add a note, or just ask for a different set."}
      </p>

      {(hasRatings || carriedRemovedCount > 0) && (
        <div className="mt-md flex flex-wrap gap-x-md gap-y-2xs text-sm tabular-nums">
          {keptCount > 0 && <span className="text-sage">{`${keptCount} kept`}</span>}
          {removedCount > 0 && <span className="text-cream">{`${removedCount} removed`}</span>}
          {carriedRemovedCount > 0 && (
            <span className="text-ash">{`+ ${carriedRemovedCount} from earlier rounds`}</span>
          )}
        </div>
      )}

      <label htmlFor={noteId} className="mt-lg block text-sm text-cream">
        Anything else we should know?
      </label>
      <textarea
        id={noteId}
        value={steering}
        maxLength={MAX_STEERING}
        rows={2}
        onChange={(e) => onSteeringChange(e.target.value)}
        placeholder="Something lighter. Nothing over two hours."
        className="mt-xs w-full resize-none rounded-control border border-ash bg-midnight p-md text-base/relaxed text-cream placeholder:text-ash"
      />
      <p className="mt-2xs text-sm tabular-nums text-ash">{`${steering.length}/${MAX_STEERING}`}</p>

      {spent && (
        <p className="mt-md max-w-[62ch] text-sm text-ash">
          That was the last round of the night. Start over to begin a fresh session.
        </p>
      )}

      <div className="mt-lg flex flex-col gap-sm sm:flex-row sm:items-center">
        <button
          type="button"
          data-testid="regenerate"
          disabled={spent || busy}
          onClick={onRegenerate}
          className={`${primaryButtonClasses} border border-transparent disabled:border-slate disabled:bg-transparent disabled:text-ash`}
        >
          {refineButtonLabel(hasRatings, hasFeedback)}
        </button>
        <button
          type="button"
          onClick={onStartOver}
          className={secondaryButtonClasses}
        >
          Start over
        </button>
      </div>
    </section>
  );
}
