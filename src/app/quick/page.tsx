// ABOUTME: Quick match — one screen, saved profiles, up to three mood chips, and go.
// ABOUTME: The whole point is speed: nothing here blocks the CTA.
"use client";

import { Suspense, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Chip } from "@/components/chip";
import { MemberAvatars } from "@/components/group-picker";
import { PhasedLoading } from "@/components/phased-loading";
import { RoughDayToggle } from "@/components/rough-day-toggle";
import { framingFor } from "@/lib/match-errors";
import {
  fetchGroup,
  requestMatch,
  startSession,
  type GroupSummary,
} from "@/lib/session-flow";
import { primaryButtonClasses, secondaryButtonClasses } from "@/components/control-classes";

/** The tag subset worth a single tap. The full vocabulary lives in the ritual. */
const QUICK_TAGS = [
  "Cozy",
  "Funny",
  "Thrilling",
  "Romantic",
  "Feel-Good",
  "Cerebral",
  "Adventurous",
  "Lighthearted",
] as const;

const MAX_QUICK_TAGS = 3;

function Quick() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const groupId = useSearchParams().get("group");

  const [group, setGroup] = useState<GroupSummary | null>(null);
  const [groupFailed, setGroupFailed] = useState(false);
  const [moodVibes, setMoodVibes] = useState<string[]>([]);
  const [limitHit, setLimitHit] = useState(false);
  const [roughDay, setRoughDay] = useState(false);

  const [matching, setMatching] = useState(false);
  const [matchDone, setMatchDone] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [matchError, setMatchError] = useState<{ message: string; kind: string | null } | null>(
    null
  );
  const errorHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const tagsLabelId = useId();

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, user, router]);

  // The CTA the user was on unmounts with the error screen; without this the
  // focus ring falls off onto <body>.
  useEffect(() => {
    if (matchError !== null) errorHeadingRef.current?.focus();
  }, [matchError]);

  useEffect(() => {
    if (!user || groupId === null) return;
    let cancelled = false;
    (async () => {
      const loaded = await fetchGroup(groupId);
      if (cancelled) return;
      // Falling back to the solo-looking screen would hide who this match is
      // actually for — the group id in the URL still drives the session.
      if (loaded === null) {
        setGroupFailed(true);
        return;
      }
      setGroup(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, groupId]);

  if (!user) return null;

  const others = (group?.members ?? []).filter((m) => m.userId !== user.userId);
  const atTagLimit = moodVibes.length >= MAX_QUICK_TAGS;

  // A group match keeps the private rough-day toggle even if member details
  // never loaded — the flag is the caller's own and is sent regardless. When we
  // have no names to show, the beneficiary is framed generically. We never show
  // or send another member's flag either way.
  const showRoughDay = others.length > 0 || (groupId !== null && groupFailed);
  const roughDayBeneficiary =
    others.length > 0 ? others.map((m) => m.name).join(" & ") : "The rest of the group";

  const toggleTag = (tag: string) => {
    if (moodVibes.includes(tag)) {
      setMoodVibes(moodVibes.filter((t) => t !== tag));
      setLimitHit(false);
      return;
    }
    // A tap that does nothing and says nothing reads as a broken control.
    if (atTagLimit) {
      setLimitHit(true);
      return;
    }
    setMoodVibes([...moodVibes, tag]);
  };

  const runMatch = async (id: string) => {
    setMatchError(null);
    setMatchDone(false);
    setMatching(true);
    const { error, kind } = await requestMatch(id);
    setMatchDone(true);
    if (error !== null) setMatchError({ message: error, kind });
  };

  const submit = async () => {
    setMatchError(null);
    setMatchDone(false);
    setMatching(true);
    const created = await startSession({
      groupId,
      moodVibes,
      moodText: "",
      discoverNew: false,
      isQuickMatch: true,
      roughDay,
      memberFlags: {},
    });
    if (created.sessionId === null) {
      setMatchDone(true);
      // A session that never got created carries no matching-error kind, so it
      // takes the default framing: a plain, retryable failure.
      setMatchError({ message: created.error ?? "Something went wrong.", kind: null });
      return;
    }
    setSessionId(created.sessionId);
    const { error, kind } = await requestMatch(created.sessionId);
    setMatchDone(true);
    if (error !== null) setMatchError({ message: error, kind });
  };

  if (matching && matchError === null) {
    return (
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[680px] px-md pb-4xl pt-2xl">
        <PhasedLoading
          done={matchDone}
          onComplete={() => {
            if (sessionId !== null) router.push(`/results/${sessionId}`);
          }}
        />
      </main>
    );
  }

  if (matchError !== null) {
    const framing = framingFor(matchError.kind);
    return (
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[680px] px-md pb-4xl pt-2xl">
        <h1
          ref={errorHeadingRef}
          tabIndex={-1}
          className="font-display text-[1.75rem]/[1.2] font-extrabold italic text-warm-white"
        >
          Not tonight, apparently
        </h1>
        <p role="alert" className="mt-md break-words text-base text-cream">
          {matchError.message}
        </p>
        <div className="mt-xl flex flex-col gap-sm sm:flex-row">
          {framing.retry && (
            <button
              type="button"
              onClick={() => {
                if (sessionId !== null) {
                  void runMatch(sessionId);
                } else {
                  void submit();
                }
              }}
              className={primaryButtonClasses}
            >
              Try again
            </button>
          )}
          {framing.loosen === true && (
            <Link href="/profile" className={primaryButtonClasses}>
              Edit your dealbreakers
            </Link>
          )}
          <button
            type="button"
            onClick={() => {
              setMatching(false);
              setMatchError(null);
              // A new vibe is a new brief. mood_vibes/mood_text/discover_new are
              // written once at creation and never updated, so holding the id
              // would match the abandoned vibe. The zero-round session left
              // behind is accepted debris.
              setSessionId(null);
            }}
            className={secondaryButtonClasses}
          >
            Change the vibe
          </button>
        </div>
      </main>
    );
  }

  const watching =
    others.length > 0 ? [user.name.trim() || "You", ...others.map((m) => m.name)] : null;

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[680px] px-md pb-4xl pt-2xl">
      <h1 className="font-display text-[1.75rem]/[1.2] font-extrabold italic text-warm-white sm:text-[2.5rem]/[1.15]">
        What are we feeling?
      </h1>

      {groupFailed && (
        <p role="alert" className="mt-lg text-sm text-ember">
          We couldn&apos;t load your group just now — the match is still for the
          whole group.
        </p>
      )}

      {watching !== null && (
        <div className="mt-lg flex items-center gap-md">
          <MemberAvatars members={group?.members ?? []} />
          <p className="min-w-0 text-sm text-ash">
            <span className="text-cream">{group?.name}</span>
            {" — "}
            {watching.join(", ")}
          </p>
        </div>
      )}

      <div className="mt-2xl">
        <p id={tagsLabelId} className="text-base text-cream">
          Pick up to three, or skip straight to the match.
        </p>
        <div
          role="group"
          aria-labelledby={tagsLabelId}
          className="mt-md flex flex-wrap gap-sm"
        >
          {QUICK_TAGS.map((tag) => {
            const selected = moodVibes.includes(tag);
            return (
              <Chip
                key={tag}
                label={tag}
                selected={selected}
                onToggle={() => toggleTag(tag)}
              />
            );
          })}
        </div>
        <p aria-live="polite" className={`mt-sm text-sm tabular-nums ${limitHit ? "text-ember" : "text-ash"}`}>
          {limitHit
            ? `${MAX_QUICK_TAGS} is the limit — remove one first.`
            : moodVibes.length === 0
              ? "No vibe set — surprise us, from your saved profiles."
              : `${moodVibes.length} of ${MAX_QUICK_TAGS} chosen`}
        </p>
      </div>

      {showRoughDay && (
        <div className="mt-2xl">
          <RoughDayToggle
            name={roughDayBeneficiary}
            checked={roughDay}
            onChange={setRoughDay}
          />
        </div>
      )}

      <div className="mt-3xl border-t border-slate pt-lg">
        <button
          type="button"
          onClick={() => void submit()}
          className={`${primaryButtonClasses} w-full sm:w-auto`}
        >
          Find our match →
        </button>
      </div>
    </main>
  );
}

export default function QuickPage() {
  return (
    <Suspense fallback={null}>
      <Quick />
    </Suspense>
  );
}
