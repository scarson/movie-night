// ABOUTME: Tag selection surface — Moods & Tones and Genres preset chip groups
// ABOUTME: plus a custom tag input (Enter adds, 30-char cap, case-insensitive dedupe).
"use client";

import { useId, useState } from "react";
import { Chip } from "@/components/chip";
import { MOOD_TAGS, GENRE_TAGS } from "@/config/tags";

const MAX_TAG_LENGTH = 30;
const PRESETS: readonly string[] = [...MOOD_TAGS, ...GENRE_TAGS];

export interface TagPickerProps {
  selected: string[];
  onChange: (tags: string[]) => void;
  tone?: "amber" | "rose";
  customPlaceholder?: string;
}

export function TagPicker({
  selected,
  onChange,
  tone = "amber",
  customPlaceholder = "Add your own…",
}: TagPickerProps) {
  const [input, setInput] = useState("");
  const labelId = useId();

  const toggle = (tag: string) => {
    onChange(
      selected.includes(tag)
        ? selected.filter((t) => t !== tag)
        : [...selected, tag]
    );
  };

  const addCustomTag = () => {
    const trimmed = input.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_TAG_LENGTH) return;
    const lowered = trimmed.toLowerCase();
    if (selected.some((t) => t.toLowerCase() === lowered)) return;
    // A custom entry that names a preset (any casing) is that preset — add it in
    // canonical casing so it toggles the preset chip, not a decoupled duplicate.
    const preset = PRESETS.find((p) => p.toLowerCase() === lowered);
    onChange([...selected, preset ?? trimmed]);
    setInput("");
  };

  const customTags = selected.filter((tag) => !PRESETS.includes(tag));

  const groups = [
    { label: "Moods & Tones", id: `${labelId}-moods`, tags: MOOD_TAGS },
    { label: "Genres", id: `${labelId}-genres`, tags: GENRE_TAGS },
  ];

  return (
    <div className="space-y-lg">
      {groups.map((group) => (
        <div key={group.label} role="group" aria-labelledby={group.id}>
          <p
            id={group.id}
            className="text-xs font-medium uppercase tracking-wider text-ash"
          >
            {group.label}
          </p>
          <div className="mt-sm flex flex-wrap gap-sm">
            {group.tags.map((tag) => (
              <Chip
                key={tag}
                label={tag}
                selected={selected.includes(tag)}
                onToggle={() => toggle(tag)}
                tone={tone}
              />
            ))}
          </div>
        </div>
      ))}

      <div>
        <div className="flex gap-sm">
          <input
            type="text"
            value={input}
            maxLength={MAX_TAG_LENGTH}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomTag();
              }
            }}
            placeholder={customPlaceholder}
            aria-label="Add a custom tag"
            className="min-h-11 flex-1 rounded-control border border-slate bg-charcoal px-md text-base text-cream placeholder:text-ash"
          />
          <button
            type="button"
            onClick={addCustomTag}
            className="min-h-11 rounded-control border border-slate px-md text-sm font-medium text-cream hover:border-ash"
          >
            Add
          </button>
        </div>
        {customTags.length > 0 && (
          <div className="mt-sm flex flex-wrap gap-sm">
            {customTags.map((tag) => (
              <Chip
                key={tag}
                label={tag}
                selected={true}
                onToggle={() => toggle(tag)}
                tone={tone}
                removable
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
