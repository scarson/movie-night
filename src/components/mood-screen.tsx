// ABOUTME: The ritual's last step — tonight's vibe, discovery preference, a free-text
// ABOUTME: note, the private rough-day toggle, and a summary that never reveals it.
"use client";

import { useId } from "react";
import { TagPicker } from "@/components/tag-picker";
import { ToggleRow } from "@/components/toggle-row";
import { RoughDayToggle } from "@/components/rough-day-toggle";

const MAX_MOOD_TEXT = 200;

export interface MoodScreenProps {
  moodVibes: string[];
  onMoodVibesChange: (tags: string[]) => void;
  moodText: string;
  onMoodTextChange: (text: string) => void;
  discoverNew: boolean;
  onDiscoverNewChange: (on: boolean) => void;
  roughDay: boolean;
  onRoughDayChange: (on: boolean) => void;
  /** Everyone else watching. Empty means solo — nobody to be generous toward. */
  otherMemberNames: string[];
  you: { name: string; vibes: string[]; comfortCount: number; watchlistCount: number };
}

export function MoodScreen({
  moodVibes,
  onMoodVibesChange,
  moodText,
  onMoodTextChange,
  discoverNew,
  onDiscoverNewChange,
  roughDay,
  onRoughDayChange,
  otherMemberNames,
  you,
}: MoodScreenProps) {
  const vibeId = useId();
  const noteId = useId();
  const summaryId = useId();

  return (
    <div>
      <section role="group" aria-labelledby={vibeId} className="mt-0">
        <h2 id={vibeId} className="font-display text-xl font-semibold text-warm-white">
          Tonight&apos;s vibe
        </h2>
        <p className="mb-md mt-2xs max-w-[62ch] text-sm text-ash">
          This tilts the picks toward what you&apos;re in the mood for right now — it
          doesn&apos;t overwrite your profile.
        </p>
        <TagPicker
          selected={moodVibes}
          onChange={onMoodVibesChange}
          customPlaceholder="Add your own, e.g. rainy Sunday"
        />
      </section>

      <div className="mt-2xl">
        <ToggleRow
          label="Show us something new"
          description="Skip what we already know you like and lean into discovery."
          checked={discoverNew}
          onChange={onDiscoverNewChange}
        />
      </div>

      <div className="mt-2xl">
        <label
          id={noteId}
          htmlFor="mood-note"
          className="block font-display text-xl font-semibold text-warm-white"
        >
          Anything else?
        </label>
        <p className="mb-md mt-2xs max-w-[62ch] text-sm text-ash">
          Optional. Describe the evening in your own words.
        </p>
        <textarea
          id="mood-note"
          value={moodText}
          maxLength={MAX_MOOD_TEXT}
          rows={3}
          onChange={(e) => onMoodTextChange(e.target.value)}
          placeholder="Long week — something light, nothing sad."
          className="w-full resize-none rounded-control border border-slate bg-charcoal p-md text-base/relaxed text-cream placeholder:text-ash"
        />
        <p className="mt-2xs text-sm tabular-nums text-ash">
          {moodText.length}/{MAX_MOOD_TEXT}
        </p>
      </div>

      {otherMemberNames.length > 0 && (
        <div className="mt-2xl">
          <RoughDayToggle
            name={otherMemberNames.join(" & ")}
            checked={roughDay}
            onChange={onRoughDayChange}
          />
        </div>
      )}

      {/*
        Deliberately carries no rough-day signal. DESIGN.md: the generosity stays
        invisible — a summary that flagged who toggled would leak it to the room.
      */}
      <section
        role="group"
        aria-labelledby={summaryId}
        className="mt-3xl rounded-panel border border-slate bg-charcoal p-lg"
      >
        <h2 id={summaryId} className="text-sm font-semibold uppercase tracking-wide text-ash">
          Session summary
        </h2>
        <dl className="mt-md space-y-md">
          <div>
            <dt className="text-base font-medium text-cream">{you.name}</dt>
            <dd className="mt-2xs text-sm text-ash">
              {you.vibes.length > 0 ? you.vibes.join(", ") : "No saved wants yet"}
            </dd>
            <dd className="text-sm tabular-nums text-ash">
              {you.comfortCount} comfort{" · "}
              {you.watchlistCount} watchlist
            </dd>
          </div>
          {otherMemberNames.map((name) => (
            <div key={name}>
              <dt className="text-base font-medium text-cream">{name}</dt>
              <dd className="mt-2xs text-sm text-ash">Using their saved profile</dd>
            </div>
          ))}
          <div className="border-t border-slate pt-md">
            <dt className="text-base font-medium text-cream">Tonight</dt>
            <dd className="mt-2xs text-sm text-amber">
              {moodVibes.length > 0 ? moodVibes.join(", ") : "Surprise us"}
            </dd>
            {moodText.trim().length > 0 && (
              <dd className="mt-2xs text-sm italic text-ash">{moodText}</dd>
            )}
          </div>
        </dl>
      </section>
    </div>
  );
}
