// ABOUTME: Single-choice picker for who's watching tonight — one row per group plus
// ABOUTME: "Just me tonight" (solo, reported as null), always offered and always last.
"use client";

import { useId } from "react";
import { outlinedBoundaryClasses } from "@/components/control-classes";

export interface GroupOption {
  id: string;
  name: string;
  members: { userId: string; name: string; avatarUrl: string | null }[];
}

export interface GroupPickerProps {
  groups: GroupOption[];
  value: string | null;
  onChange: (groupId: string | null) => void;
}

/**
 * The selection a freshly-loaded hub starts on: the group itself when there is
 * exactly one, solo otherwise. With several groups nothing is assumed — starting
 * on solo means a stray tap can never match for the wrong group.
 */
export function defaultGroupSelection(groups: GroupOption[]): string | null {
  return groups.length === 1 ? groups[0].id : null;
}

export function MemberAvatars({ members }: { members: GroupOption["members"] }) {
  return (
    <span aria-hidden="true" className="flex shrink-0 -space-x-2">
      {members.slice(0, 4).map((member) =>
        member.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Google avatar URL; no image optimization on Workers
          <img
            key={member.userId}
            src={member.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-7 w-7 rounded-pill border-2 border-midnight"
          />
        ) : (
          <span
            key={member.userId}
            className="flex h-7 w-7 items-center justify-center rounded-pill border-2 border-midnight bg-slate text-sm text-cream"
          >
            {member.name.charAt(0)}
          </span>
        )
      )}
    </span>
  );
}

export function GroupPicker({ groups, value, onChange }: GroupPickerProps) {
  const name = useId();
  const legendId = useId();

  const rowClasses = (selected: boolean) =>
    `flex min-h-11 cursor-pointer items-center justify-between gap-md rounded-panel border p-md ${
      selected
        ? "border-amber bg-amber-glow"
        : `${outlinedBoundaryClasses} bg-charcoal`
    } has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-amber`;

  return (
    // `min-w-0` overrides the UA's `min-inline-size: min-content` on fieldset —
    // without it the group rows refuse to shrink and force page-wide h-scroll.
    <fieldset role="radiogroup" aria-labelledby={legendId} className="min-w-0">
      <legend id={legendId} className="sr-only">
        Who&apos;s watching tonight?
      </legend>
      <div className="space-y-sm">
        {groups.map((group) => {
          const selected = value === group.id;
          return (
            <label key={group.id} className={rowClasses(selected)}>
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={selected}
                onChange={() => onChange(group.id)}
              />
              <span className="min-w-0">
                <span
                  className={`block text-base font-medium ${
                    selected ? "text-amber" : "text-cream"
                  }`}
                >
                  {group.name}
                </span>
                <span className="mt-2xs block truncate text-sm text-ash">
                  {group.members.map((member) => member.name).join(", ")}
                </span>
              </span>
              <MemberAvatars members={group.members} />
            </label>
          );
        })}

        <label className={rowClasses(value === null)}>
          <input
            type="radio"
            name={name}
            className="sr-only"
            checked={value === null}
            onChange={() => onChange(null)}
          />
          <span className="min-w-0">
            <span
              className={`block text-base font-medium ${
                value === null ? "text-amber" : "text-cream"
              }`}
            >
              Just me tonight
            </span>
            <span className="mt-2xs block text-sm text-ash">
              Your profile only
            </span>
          </span>
        </label>
      </div>
    </fieldset>
  );
}
