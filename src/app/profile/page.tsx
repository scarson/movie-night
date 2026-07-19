// ABOUTME: Profile settings — the taste profile on its own, the reduce-animations
// ABOUTME: preference, sign out, and account deletion with a typed confirmation.
"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { ProfileEditor, type ProfileDraft } from "@/components/profile-editor";
import { ToggleRow } from "@/components/toggle-row";
import type { TitleRef } from "@/components/title-search";
import {
  fetchProfileDraft,
  fetchQuickPicks,
  saveProfile,
} from "@/lib/session-flow";
import {
  reducedMotionServerSnapshot,
  reducedMotionSnapshot,
  setReducedMotion,
  subscribeReducedMotion,
  syncReducedMotion,
} from "@/lib/reduced-motion";

const CONFIRM_WORD = "delete";

const PRIMARY_BUTTON =
  "flex min-h-12 items-center justify-center rounded-control bg-amber px-xl text-base font-semibold text-midnight transition-colors duration-100 hover:bg-warm-white disabled:bg-slate disabled:text-ash";
const SECONDARY_BUTTON =
  "flex min-h-12 items-center justify-center rounded-control border border-slate px-xl text-base font-medium text-cream transition-colors duration-100 hover:border-ash";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mt-3xl border-t border-slate pt-xl">
      <h2 id={headingId} className="font-display text-xl font-semibold text-warm-white">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function ProfilePage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [quickPicks, setQuickPicks] = useState<TitleRef[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [confirmWord, setConfirmWord] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const wasConfirmingRef = useRef(false);
  const confirmFieldId = useId();

  // The preference lives on <html>, seeded from storage by ReducedMotionBoot.
  // Subscribing keeps the switch honest without setting state in an effect.
  const reduceMotion = useSyncExternalStore(
    subscribeReducedMotion,
    reducedMotionSnapshot,
    reducedMotionServerSnapshot
  );

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, user, router]);

  // ReducedMotionBoot already does this app-wide, but the page that OWNS the
  // setting should not read a stale switch if it is ever mounted without it.
  // Idempotent: it only re-applies what storage already says.
  useEffect(() => {
    syncReducedMotion();
  }, []);

  // Closing the confirm remounts the trigger, so focus has to be handed back
  // after that render — calling focus() inside the handler finds a null ref.
  useEffect(() => {
    if (wasConfirmingRef.current && !confirming) deleteTriggerRef.current?.focus();
    wasConfirmingRef.current = confirming;
  }, [confirming]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [loaded, picks] = await Promise.all([fetchProfileDraft(), fetchQuickPicks()]);
      if (cancelled) return;
      // An empty editor over a failed load would PUT the real profile away.
      if (loaded === null) {
        setLoadFailed(true);
        return;
      }
      setDraft(loaded);
      setQuickPicks(picks);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return null;

  const save = async () => {
    if (draft === null) return;
    setSaveError(null);
    setSaveState("saving");
    const error = await saveProfile(draft);
    setSaveState(error === null ? "saved" : "idle");
    if (error !== null) setSaveError(error);
  };

  const remove = async () => {
    setDeleteError(null);
    setDeleting(true);
    try {
      const res = await fetch("/api/user/account", { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setDeleteError(body?.error ?? "We couldn't delete your account just now.");
        setDeleting(false);
        return;
      }
      router.replace("/");
    } catch {
      setDeleteError("We couldn't delete your account just now.");
      setDeleting(false);
    }
  };

  const closeConfirm = () => {
    setConfirming(false);
    setConfirmWord("");
    setDeleteError(null);
  };

  return (
    <main className="mx-auto w-full max-w-[680px] px-md pb-4xl pt-2xl">
      <h1 className="font-display text-[1.75rem]/[1.2] font-extrabold italic text-warm-white sm:text-[2.5rem]/[1.15]">
        Your taste, on file
      </h1>
      <p className="mt-sm max-w-[62ch] text-base text-ash">
        Every match starts here. Change it whenever your taste does — tonight&apos;s mood
        is set separately, each time.
      </p>

      {loadFailed && (
        <p role="alert" className="mt-xl max-w-[62ch] text-base text-ember">
          We couldn&apos;t load your profile. Reload the page rather than starting again
          from scratch — an empty form saved over the top would lose what&apos;s there.
        </p>
      )}

      {draft !== null && (
        <>
          <div className="mt-2xl">
            <ProfileEditor value={draft} onChange={setDraft} quickPicks={quickPicks} />
          </div>
          <div className="mt-2xl flex flex-wrap items-center gap-md">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saveState === "saving"}
              className={PRIMARY_BUTTON}
            >
              {saveState === "saving" ? "Saving…" : "Save changes"}
            </button>
            <p aria-live="polite" className="text-sm text-sage">
              {saveState === "saved" ? "Saved" : ""}
            </p>
          </div>
          {saveError !== null && (
            <p role="alert" className="mt-md text-sm text-ember">
              {saveError}
            </p>
          )}
        </>
      )}

      <Section title="Motion">
        <div className="mt-md">
          <ToggleRow
            label="Reduce animations"
            description="Entrances become instant. Useful once the fades stop being a novelty."
            checked={reduceMotion}
            onChange={setReducedMotion}
          />
        </div>
      </Section>

      <Section title="Account">
        <p className="mt-sm text-base text-cream">{user.email}</p>
        <div className="mt-lg flex flex-wrap gap-md">
          <button type="button" onClick={() => void signOut()} className={SECONDARY_BUTTON}>
            Sign out
          </button>
          {!confirming && (
            <button
              ref={deleteTriggerRef}
              type="button"
              onClick={() => setConfirming(true)}
              className="flex min-h-12 items-center justify-center rounded-control border border-ember px-xl text-base font-medium text-cream transition-colors duration-100 hover:bg-ember hover:text-midnight"
            >
              Delete my account
            </button>
          )}
        </div>

        {confirming && (
          <div className="mt-lg rounded-panel border border-ember p-lg">
            <p
              data-testid="delete-explanation"
              className="max-w-[62ch] text-base/[1.6] text-cream"
            >
              This deletes your profile, your groups and your sign-in. Anything you shared
              with other people — the sessions you ran together and what they were shown —
              stays with them, with your name replaced by &ldquo;[deleted user]&rdquo;, so
              their history doesn&apos;t develop holes. This can&apos;t be undone.
            </p>

            <label htmlFor={confirmFieldId} className="mt-lg block text-sm text-cream">
              Type delete to confirm
            </label>
            <input
              id={confirmFieldId}
              type="text"
              value={confirmWord}
              onChange={(e) => setConfirmWord(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="mt-xs w-full max-w-64 rounded-control border border-slate bg-midnight px-md py-sm text-base text-cream"
            />

            {deleteError !== null && (
              <p role="alert" className="mt-md text-sm text-ember">
                {deleteError}
              </p>
            )}

            <div className="mt-lg flex flex-wrap gap-md">
              <button
                type="button"
                data-testid="confirm-delete"
                disabled={confirmWord.trim().toLowerCase() !== CONFIRM_WORD || deleting}
                onClick={() => void remove()}
                className="flex min-h-12 items-center justify-center rounded-control border border-ember px-xl text-base font-medium text-cream transition-colors duration-100 hover:bg-ember hover:text-midnight disabled:border-slate disabled:text-ash disabled:hover:bg-transparent disabled:hover:text-ash"
              >
                {deleting ? "Deleting…" : "Delete my account for good"}
              </button>
              <button type="button" onClick={closeConfirm} className={SECONDARY_BUTTON}>
                Keep my account
              </button>
            </div>
          </div>
        )}
      </Section>
    </main>
  );
}
