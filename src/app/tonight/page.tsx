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

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[680px] px-md pb-4xl pt-2xl">
      <h1 className="font-display text-[1.75rem]/[1.2] font-extrabold italic text-warm-white sm:text-[2.5rem]/[1.15]">
        {firstName ? `${firstName}, who's watching tonight?` : "Who's watching tonight?"}
      </h1>

      <div className="mt-xl">
        {groups === null ? (
          <div className="space-y-sm">
            <p className="sr-only">Loading your groups…</p>
            <div aria-hidden="true" className="h-20 rounded-panel bg-charcoal" />
            <div aria-hidden="true" className="h-20 rounded-panel bg-charcoal" />
          </div>
        ) : (
          <div className="animate-rise-fade">
            <GroupPicker groups={groups} value={selected} onChange={setSelected} />
            {groupsFailed && (
              <p role="alert" className="mt-sm text-sm text-ember">
                Couldn&apos;t load your groups — you can still watch solo.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-2xl flex flex-col gap-sm sm:flex-row">
        <Link
          href={`/quick${target}`}
          className="flex min-h-12 items-center justify-center rounded-control bg-amber px-xl text-base font-semibold text-midnight transition-colors duration-100 hover:bg-warm-white"
        >
          Quick match
        </Link>
        <Link
          href={`/ritual${target}`}
          className="flex min-h-12 items-center justify-center rounded-control border border-ash px-xl text-base font-medium text-cream transition-colors duration-100 hover:border-cream"
        >
          The full ritual
        </Link>
      </div>
      <p className="mt-md max-w-[46ch] text-sm text-ash">
        Quick match reads the saved profiles and goes. The full ritual walks
        through them first — comfort films, dealbreakers, tonight&apos;s mood.
      </p>

      <div className="mt-3xl border-t border-slate pt-lg">
        <Link
          href="/groups"
          className="inline-flex min-h-11 items-center text-sm font-medium text-amber hover:text-warm-white"
        >
          Groups &amp; invites
        </Link>
      </div>
    </main>
  );
}
