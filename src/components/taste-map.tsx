// ABOUTME: The taste map — editorial per-member analysis in person colors, the overlap
// ABOUTME: zone, tension points, and a weighting line that never says who or why.

import type { TasteMap as TasteMapData, MemberTaste } from "@/types/matching";

/**
 * DESIGN.md's two named person colors plus two more from the same curated set,
 * all verified ≥4.5:1 on both midnight and charcoal. Groups larger than the set
 * wrap around; the legend names every person, so color is never the only cue.
 */
export const PERSON_COLORS = [
  "var(--person-a)",
  "var(--person-b)",
  "var(--person-c)",
  "var(--person-d)",
] as const;

const OVERLAP_COLOR = "var(--overlap)";

export function personColor(index: number): string {
  return PERSON_COLORS[index % PERSON_COLORS.length];
}

/** One entrance step. DESIGN.md: 80ms stagger, fade + slight drift, no bounce. */
const STAGGER_MS = 80;

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{ color, borderColor: color }}
      className="inline-flex items-center rounded-pill border px-md py-2xs text-xs"
    >
      {label}
    </span>
  );
}

function MemberSection({
  member,
  color,
  delayMs,
}: {
  member: MemberTaste;
  color: string;
  delayMs: number;
}) {
  const headingId = `taste-${member.userId}`;
  return (
    <section
      role="group"
      aria-labelledby={headingId}
      style={{ borderColor: color, animationDelay: `${delayMs}ms` }}
      className="animate-rise-fade border-t pt-md"
    >
      <h3
        id={headingId}
        style={{ color }}
        className="font-display text-xl font-semibold"
      >
        {member.name}
      </h3>
      <p className="mt-sm max-w-[62ch] text-base/[1.7] text-cream">{member.summary}</p>
      {(member.primaryVibes.length > 0 || member.genreAffinities.length > 0) && (
        <div className="mt-md flex flex-wrap gap-sm">
          {[...member.primaryVibes, ...member.genreAffinities].map((tag) => (
            <Tag key={tag} label={tag} color={color} />
          ))}
        </div>
      )}
    </section>
  );
}

export interface TasteMapProps {
  tasteMap: TasteMapData;
  /**
   * True only when the VIEWER set their own rough-day flag. Never derived from
   * anyone else's — the toggle is private and the reason is never named.
   */
  showWeightingNote: boolean;
}

export function TasteMap({ tasteMap, showWeightingNote }: TasteMapProps) {
  const { members, overlap } = tasteMap;
  const solo = members.length < 2;
  const overlapHeadingId = "taste-overlap";

  // The two tastes meeting, drawn literally: each person's color running into
  // the overlap hue. Semantic, not decoration — and never a purple wash.
  const meetingRule = `linear-gradient(90deg, ${members
    .map((_, i) => personColor(i))
    .join(", ")}, ${OVERLAP_COLOR})`;

  let step = 0;
  const nextDelay = () => step++ * STAGGER_MS;

  return (
    <div className="flex flex-col gap-2xl">
      {!solo && (
        <div
          style={{ animationDelay: `${nextDelay()}ms` }}
          className="animate-rise-fade"
        >
          <ul
            aria-label="Taste map key"
            className="flex flex-wrap items-center gap-x-lg gap-y-sm text-xs text-ash"
          >
            {members.map((member, i) => (
              <li key={member.userId} className="flex items-center gap-sm">
                <span
                  aria-hidden="true"
                  style={{ background: personColor(i) }}
                  className="size-2 shrink-0 rounded-pill"
                />
                {member.name}
              </li>
            ))}
            <li className="flex items-center gap-sm">
              <span
                aria-hidden="true"
                style={{ background: OVERLAP_COLOR }}
                className="size-2 shrink-0 rounded-pill"
              />
              Where you meet
            </li>
          </ul>
        </div>
      )}

      {members.map((member, i) => (
        <MemberSection
          key={member.userId}
          member={member}
          color={personColor(i)}
          delayMs={nextDelay()}
        />
      ))}

      <section
        role="group"
        aria-labelledby={overlapHeadingId}
        style={{ animationDelay: `${nextDelay()}ms` }}
        className="animate-rise-fade"
      >
        <div aria-hidden="true" style={{ background: meetingRule }} className="h-0.5" />
        <h3
          id={overlapHeadingId}
          style={{ color: OVERLAP_COLOR }}
          className="mt-md font-display text-xl font-semibold"
        >
          {solo ? "What ties it together" : "Where you meet"}
        </h3>
        <p className="mt-sm max-w-[62ch] text-base/[1.7] text-cream">{overlap.summary}</p>

        {overlap.sharedVibes.length > 0 && (
          <div className="mt-md flex flex-wrap gap-sm">
            {overlap.sharedVibes.map((vibe) => (
              <Tag key={vibe} label={vibe} color={OVERLAP_COLOR} />
            ))}
          </div>
        )}

        {overlap.tensionPoints.length > 0 && (
          <div className="mt-lg">
            <h4 className="text-xs uppercase tracking-wider text-ash">Where it pulls</h4>
            <ul
              aria-label="Where it pulls"
              className="mt-sm flex max-w-[62ch] flex-col gap-sm"
            >
              {overlap.tensionPoints.map((point) => (
                <li key={point} className="flex gap-sm text-base/[1.6] text-cream">
                  <span aria-hidden="true" className="mt-2 h-px w-4 shrink-0 bg-ember" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {showWeightingNote && (
        <p
          data-testid="weighting-note"
          style={{ animationDelay: `${nextDelay()}ms` }}
          className="animate-rise-fade max-w-[62ch] border-t border-slate pt-md text-sm text-ash"
        >
          At your request, tonight&apos;s picks lean toward everyone else.{" "}
          <span className="text-slate">Only you can see this.</span>
        </p>
      )}
    </div>
  );
}
