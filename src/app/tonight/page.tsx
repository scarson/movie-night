// ABOUTME: The signed-in home — greets by first name, asks who's watching, and offers
// ABOUTME: the two ways in: quick match (primary) or the full ritual.
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import {
  GroupPicker,
  defaultGroupSelection,
  type GroupOption,
} from "@/components/group-picker";
import {
  compactOutlinedButtonClasses,
  primaryButtonClasses,
  secondaryButtonClasses,
} from "@/components/control-classes";

export default function Tonight() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [groups, setGroups] = useState<GroupOption[] | null>(null);
  const [groupsFailed, setGroupsFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/groups");
        if (!res.ok) throw new Error(`groups failed: ${res.status}`);
        const body = (await res.json()) as { groups: GroupOption[] };
        if (cancelled) return;
        setGroups(body.groups);
        setSelected(defaultGroupSelection(body.groups));
      } catch {
        if (cancelled) return;
        setGroups([]);
        setGroupsFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return null;

  // Google's `name` claim is optional, so the stored name can be empty.
  const firstName = user.name.trim().split(" ")[0];
  const target = selected === null ? "" : `?group=${encodeURIComponent(selected)}`;

  // The catch leaves `groups` as [] with `groupsFailed` set, so an empty list means
  // either "none" or "we couldn't find out". The two reads part company there: the
  // invite has to know there are none before it offers a first group, while the
  // picker is kept whenever solo can't be stated as a fact.
  const hasGroups = groups !== null && groups.length > 0;
  const showInvite = groups !== null && !groupsFailed && groups.length === 0;

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[680px] px-md pb-4xl pt-2xl">
      <h1 className="font-display text-[1.75rem]/[1.2] font-extrabold italic text-warm-white sm:text-[2.5rem]/[1.15]">
        {firstName ? `${firstName}, who's watching tonight?` : "Who's watching tonight?"}
      </h1>

      {/* This region loads to 168px with one group (two picker rows) and 24px with
          none, so no single placeholder fits both. Measured at 1280px, one 80px
          block settles 8px for a solo account and 88px for a one-group account;
          two blocks would trade that for 96px and 0px. One block, because the
          account with no groups is the one this screen was reworked for. */}
      <div className="mt-xl">
        {groups === null ? (
          <div className="space-y-sm">
            <p role="status" className="sr-only">Loading tonight&apos;s options…</p>
            <div aria-hidden="true" className="h-20 rounded-panel bg-charcoal" />
          </div>
        ) : (
          <div className="animate-rise-fade">
            {/* With no groups the picker is a radiogroup of one, pre-selected and
                unchangeable. The line replacing it still says who the match is for. */}
            {hasGroups || groupsFailed ? (
              <GroupPicker groups={groups} value={selected} onChange={setSelected} />
            ) : (
              <p className="text-base text-cream">Just you tonight.</p>
            )}
            {groupsFailed && (
              <p role="alert" className="mt-sm text-sm text-ember">
                Couldn&apos;t load your groups — you can still watch solo.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Everything below depends on the groups fetch: both CTAs encode the chosen
          group and `target` is empty until it resolves, and the footer swaps
          between two controls. Settling them together keeps a live control from
          being replaced under a focused ring, and keeps the explanatory line from
          describing buttons that are not on screen yet. */}
      {groups === null ? (
        <div aria-hidden="true">
          <div className="mt-2xl h-10 w-full max-w-[46ch] rounded-control bg-charcoal" />
          {/* Measured at 1280px, not estimated: the buttons render 156.6px and
              159.3px wide and 48px tall, so one w-40 is within 3.4px of both.
              They are content-sized, so this cannot be exact — it is close enough
              that a "more precise" pair of widths measured worse. */}
          <div className="mt-md flex flex-col gap-sm sm:flex-row">
            <div className="h-12 w-full rounded-control bg-charcoal sm:w-40" />
            <div className="h-12 w-full rounded-control bg-charcoal sm:w-40" />
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2xl max-w-[46ch] text-sm text-ash">
            Quick match reads the saved profiles and goes. The full ritual walks
            through them first — comfort films, dealbreakers, tonight&apos;s mood.
          </p>

          <div className="mt-md flex flex-col gap-sm sm:flex-row">
            <Link
              href={`/quick${target}`}
              className={primaryButtonClasses}
            >
              Quick match
            </Link>
            <Link
              href={`/ritual${target}`}
              className={secondaryButtonClasses}
            >
              The full ritual
            </Link>
          </div>
        </>
      )}

      <div className="mt-3xl border-t border-slate pt-lg">
        {groups === null ? (
          <div aria-hidden="true" className="h-11 w-40 rounded-control bg-charcoal" />
        ) : showInvite ? (
          <>
            <p className="max-w-[46ch] text-sm text-ash">
              Watching with someone else? Start a group and send them the link —
              the match reads both profiles.
            </p>
            <Link href="/groups" className={`${compactOutlinedButtonClasses} mt-md inline-flex items-center`}>
              Invite someone
            </Link>
          </>
        ) : (
          <Link
            href="/groups"
            className="inline-flex min-h-11 items-center text-sm font-medium text-amber hover:text-warm-white"
          >
            Groups &amp; invites
          </Link>
        )}
      </div>
    </main>
  );
}
