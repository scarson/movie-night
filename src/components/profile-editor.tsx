// ABOUTME: The taste-profile form — comfort titles, watchlist, wants, dealbreakers and
// ABOUTME: streaming services. Fully controlled: the page owns loading and saving.
"use client";

import { useId } from "react";
import { Chip } from "@/components/chip";
import { TagPicker } from "@/components/tag-picker";
import { TitleSearch, type TitleRef } from "@/components/title-search";

/** The services Phase 1 asks about. Order is the list users scan, not alphabetical. */
export const STREAMING_SERVICES = [
  "Netflix",
  "Max",
  "Disney+",
  "Prime Video",
  "Hulu",
  "Apple TV+",
  "Paramount+",
  "Peacock",
  "Criterion Channel",
  "MUBI",
] as const;

export interface ProfileDraft {
  comfortTitles: TitleRef[];
  watchlist: TitleRef[];
  vibes: string[];
  dealbreakers: string[];
  streamingServices: string[];
}

export interface ProfileEditorProps {
  value: ProfileDraft;
  onChange: (draft: ProfileDraft) => void;
  /** Popular catalog titles offered as tap-to-add chips above the comfort search. */
  quickPicks?: TitleRef[];
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <section role="group" aria-labelledby={headingId} className="mt-2xl first:mt-0">
      <h2 id={headingId} className="font-display text-xl font-semibold text-warm-white">
        {title}
      </h2>
      <p className="mb-md mt-2xs max-w-[62ch] text-sm text-ash">{hint}</p>
      {children}
    </section>
  );
}

export function ProfileEditor({ value, onChange, quickPicks = [] }: ProfileEditorProps) {
  const update = (patch: Partial<ProfileDraft>) => onChange({ ...value, ...patch });

  const toggleService = (service: string) =>
    update({
      streamingServices: value.streamingServices.includes(service)
        ? value.streamingServices.filter((s) => s !== service)
        : [...value.streamingServices, service],
    });

  return (
    <div>
      <Section
        title="Comfort films"
        hint="The ones you return to. Tap a suggestion or search for your own."
      >
        <TitleSearch
          selected={value.comfortTitles}
          onChange={(comfortTitles) => update({ comfortTitles })}
          quickPicks={quickPicks}
          placeholder="Search comfort films…"
        />
      </Section>

      <Section
        title="Watchlist"
        hint="Films you haven't seen yet but keep meaning to."
      >
        <TitleSearch
          selected={value.watchlist}
          onChange={(watchlist) => update({ watchlist })}
          placeholder="Search your watchlist…"
        />
      </Section>

      <Section
        title="I want"
        hint="Moods, tones and genres you're drawn to — pick from these or add your own."
      >
        <TagPicker
          selected={value.vibes}
          onChange={(vibes) => update({ vibes })}
          customPlaceholder="Add your own, e.g. 90s nostalgia"
        />
      </Section>

      <Section
        title="Dealbreakers"
        hint="Anything that's off the table, whatever else is going for it."
      >
        <TagPicker
          selected={value.dealbreakers}
          onChange={(dealbreakers) => update({ dealbreakers })}
          tone="rose"
          customPlaceholder="Add your own, e.g. animal death"
        />
      </Section>

      <Section
        title="Streaming services"
        hint="Where you can actually watch tonight."
      >
        <div className="flex flex-wrap gap-sm">
          {STREAMING_SERVICES.map((service) => (
            <Chip
              key={service}
              label={service}
              selected={value.streamingServices.includes(service)}
              onToggle={() => toggleService(service)}
            />
          ))}
        </div>
      </Section>
    </div>
  );
}
