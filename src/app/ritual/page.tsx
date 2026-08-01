// ABOUTME: The full ritual — a step per member, then tonight's mood, then the match.
// ABOUTME: Only the signed-in user's profile is editable; others bring their saved one.
"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { MemberAvatars } from "@/components/group-picker";
import { PhasedLoading } from "@/components/phased-loading";
import { ProgressSteps } from "@/components/progress-steps";
import { MoodScreen } from "@/components/mood-screen";
import { ProfileEditor, type ProfileDraft } from "@/components/profile-editor";
import type { TitleRef } from "@/components/title-search";
import { RoughDayToggle } from "@/components/rough-day-toggle";
import {
  fetchProfileDraft,
  fetchQuickPicks,
  fetchGroup,
  requestMatch,
  saveProfile,
  startSession,
  type Member,
} from "@/lib/session-flow";
import { primaryButtonClasses, secondaryButtonClasses } from "@/components/control-classes";

const EMPTY_MEMBERS: Member[] = [];

function Ritual() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const groupId = useSearchParams().get("group");

  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [quickPicks, setQuickPicks] = useState<TitleRef[]>([]);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [moodVibes, setMoodVibes] = useState<string[]>([]);
  const [moodText, setMoodText] = useState("");
  const [discoverNew, setDiscoverNew] = useState(false);
  const [roughDay, setRoughDay] = useState(false);
  const [memberFlags, setMemberFlags] = useState<Record<string, boolean>>({});

  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [matching, setMatching] = useState(false);
  const [matchDone, setMatchDone] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const errorHeadingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, user, router]);

  // The CTA the user was on unmounts with the error screen; without this the
  // focus ring falls off onto <body>.
  useEffect(() => {
    if (matchError !== null) errorHeadingRef.current?.focus();
  }, [matchError]);

  // A stepper that swaps its content without moving focus leaves screen-reader
  // and keyboard users on a button whose surroundings silently changed.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [profile, picks, loadedGroup] = await Promise.all([
        fetchProfileDraft(),
        fetchQuickPicks(),
        groupId === null ? Promise.resolve({ name: "", members: EMPTY_MEMBERS }) : fetchGroup(groupId),
      ]);
      if (cancelled) return;
      // An empty editor over a failed load would let "Continue" PUT the saved
      // profile away, so a load failure blocks the flow rather than starting blank.
      if (profile === null) {
        setLoadError("We couldn't load your profile. Reload to try again.");
        return;
      }
      if (loadedGroup === null) {
        setLoadError("We couldn't load that group. Reload to try again.");
        return;
      }
      setDraft(profile);
      setQuickPicks(picks);
      setMembers(loadedGroup.members);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, groupId]);

  if (!user) return null;

  if (loadError !== null) {
    return (
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[680px] px-md pb-4xl pt-2xl">
        <p role="alert" className="text-base text-ember">
          {loadError}
        </p>
      </main>
    );
  }

  if (draft === null || members === null) {
    return (
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[680px] px-md pb-4xl pt-2xl">
        <p className="sr-only">Loading your ritual…</p>
        <div aria-hidden="true" className="h-8 w-48 rounded-control bg-charcoal" />
        <div aria-hidden="true" className="mt-2xl h-64 rounded-panel bg-charcoal" />
      </main>
    );
  }

  const you: Member = { userId: user.userId, name: user.name.trim() || "You", avatarUrl: user.avatarUrl };
  const others = members.filter((m) => m.userId !== user.userId);
  const orderedMembers = [you, ...others];
  const steps = [...orderedMembers.map((m) => m.name), "Mood"];
  const moodStep = steps.length - 1;

  const advance = async () => {
    if (step === 0) {
      setSaving(true);
      setSaveError(null);
      const error = await saveProfile(draft);
      setSaving(false);
      if (error !== null) {
        setSaveError(error);
        return;
      }
    }
    setStep(step + 1);
  };

  const runMatch = async (id: string) => {
    setMatchError(null);
    setMatchDone(false);
    setMatching(true);
    const result = await requestMatch(id);
    setMatchDone(true);
    if (result !== null) setMatchError(result);
  };

  const submit = async () => {
    setMatchError(null);
    setMatching(true);
    setMatchDone(false);
    const created = await startSession({
      groupId,
      moodVibes,
      moodText,
      discoverNew,
      isQuickMatch: false,
      roughDay,
      memberFlags,
    });
    if (created.sessionId === null) {
      setMatchDone(true);
      setMatchError(created.error);
      return;
    }
    setSessionId(created.sessionId);
    const error = await requestMatch(created.sessionId);
    setMatchDone(true);
    if (error !== null) setMatchError(error);
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
    return (
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[680px] px-md pb-4xl pt-2xl">
        <h1
          ref={errorHeadingRef}
          tabIndex={-1}
          className="font-display text-[1.75rem]/[1.2] font-extrabold italic text-warm-white"
        >
          Not tonight, apparently
        </h1>
        <p role="alert" className="mt-md text-base text-cream">
          {matchError}
        </p>
        <div className="mt-xl flex flex-col gap-sm sm:flex-row">
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
          <button
            type="button"
            onClick={() => {
              setMatching(false);
              setMatchError(null);
            }}
            className={secondaryButtonClasses}
          >
            Back to the mood
          </button>
        </div>
      </main>
    );
  }

  const currentMember = step < moodStep ? orderedMembers[step] : null;

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[680px] px-md pb-4xl pt-2xl">
      <ProgressSteps steps={steps} current={step} onStepSelect={setStep} />

      <div className="mt-2xl">
        {step === 0 && (
          <>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="font-display text-[1.75rem]/[1.2] font-extrabold italic text-warm-white sm:text-[2.5rem]/[1.15]"
            >
              What do you love?
            </h1>
            <p className="mt-sm max-w-[62ch] text-base text-ash">
              This is your standing taste profile — it&apos;s saved, and every
              future match reads from it.
            </p>
            <div className="mt-2xl">
              <ProfileEditor value={draft} onChange={setDraft} quickPicks={quickPicks} />
            </div>
          </>
        )}

        {currentMember !== null && step > 0 && (
          <>
            <div className="flex items-center gap-md">
              <MemberAvatars members={[currentMember]} />
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="font-display text-[1.75rem]/[1.2] font-extrabold italic text-warm-white"
              >
                {currentMember.name}
              </h1>
            </div>
            <p className="mt-md max-w-[62ch] text-base text-ash">
              We&apos;ll use {currentMember.name}&apos;s saved profile — only they
              can edit it, from their own account.
            </p>
            <div className="mt-2xl">
              <RoughDayStep
                member={currentMember}
                everyoneElse={orderedMembers.filter((m) => m.userId !== currentMember.userId)}
                checked={memberFlags[currentMember.userId] ?? false}
                onChange={(on) =>
                  setMemberFlags({ ...memberFlags, [currentMember.userId]: on })
                }
              />
            </div>
          </>
        )}

        {step === moodStep && (
          <>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="font-display text-[1.75rem]/[1.2] font-extrabold italic text-warm-white sm:text-[2.5rem]/[1.15]"
            >
              What are we feeling tonight?
            </h1>
            <div className="mt-2xl">
              <MoodScreen
                moodVibes={moodVibes}
                onMoodVibesChange={setMoodVibes}
                moodText={moodText}
                onMoodTextChange={setMoodText}
                discoverNew={discoverNew}
                onDiscoverNewChange={setDiscoverNew}
                roughDay={roughDay}
                onRoughDayChange={setRoughDay}
                otherMemberNames={others.map((m) => m.name)}
                you={{
                  name: you.name,
                  vibes: draft.vibes,
                  comfortCount: draft.comfortTitles.length,
                  watchlistCount: draft.watchlist.length,
                }}
              />
            </div>
          </>
        )}
      </div>

      {saveError !== null && (
        <p role="alert" className="mt-lg text-sm text-ember">
          {saveError}
        </p>
      )}

      <div className="mt-3xl flex flex-col gap-sm border-t border-slate pt-lg sm:flex-row-reverse sm:justify-start">
        {step === moodStep ? (
          <button
            type="button"
            onClick={() => void submit()}
            className={primaryButtonClasses}
          >
            Find our match →
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void advance()}
            disabled={saving}
            className={`${primaryButtonClasses} disabled:opacity-60`}
          >
            {saving ? "Saving…" : "Continue →"}
          </button>
        )}
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            className={secondaryButtonClasses}
          >
            Back
          </button>
        )}
      </div>
    </main>
  );
}

function RoughDayStep({
  member,
  everyoneElse,
  checked,
  onChange,
}: {
  member: Member;
  everyoneElse: Member[];
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  if (everyoneElse.length === 0) return null;
  return (
    <>
      <p className="mb-md text-sm text-ash">
        {member.name}, this one&apos;s yours to set.
      </p>
      <RoughDayToggle
        name={everyoneElse.map((m) => m.name).join(" & ")}
        checked={checked}
        onChange={onChange}
      />
    </>
  );
}

export default function RitualPage() {
  return (
    <Suspense fallback={null}>
      <Ritual />
    </Suspense>
  );
}
