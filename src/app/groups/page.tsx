// ABOUTME: Group management — the caller's groups with member lists and invite links,
// ABOUTME: plus create-a-group, join-by-code, and a two-step leave confirmation.
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { MemberAvatars } from "@/components/group-picker";
import { outlinedControlClasses } from "@/components/control-classes";

interface GroupSummary {
  id: string;
  name: string;
  inviteCode: string;
  members: { userId: string; name: string; avatarUrl: string | null }[];
}

const COPIED_RESET_MS = 2000;

function inviteLink(code: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/groups/join/${code}`;
}

/**
 * Reads the invite code out of whatever the user pasted. The card next to this
 * field shows a full URL beside a Copy button, so pasting the link is the likely
 * first attempt; the code is its last path segment. Case is never normalized —
 * invite codes are case-sensitive.
 */
function inviteCodeFrom(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** Fetches the caller's groups. Returns null on any failure — callers decide what to show. */
async function fetchGroupList(): Promise<GroupSummary[] | null> {
  try {
    const res = await fetch("/api/groups");
    if (!res.ok) return null;
    const body = (await res.json()) as { groups: GroupSummary[] };
    return body.groups;
  } catch {
    return null;
  }
}

export default function Groups() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const mounted = useRef(true);

  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [leaveError, setLeaveError] = useState<{
    groupId: string;
    message: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Opening or closing the leave confirm unmounts whatever the keyboard user was
  // on, so focus is handed off deliberately: to the confirm on open, back to the
  // trigger on cancel, and to the section heading once the group is gone.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const leaveTriggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const focusAfterClose = useRef<string | "heading" | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const list = await fetchGroupList();
      if (cancelled) return;
      setGroups(list ?? []);
      setListFailed(list === null);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  /** Re-reads the list after a mutation; a failed reload leaves the last list on screen. */
  async function reloadGroups() {
    const list = await fetchGroupList();
    if (!mounted.current) return;
    setGroups((current) => list ?? current ?? []);
    setListFailed(list === null);
  }

  useEffect(() => {
    if (confirmingLeave !== null) {
      confirmRef.current?.focus();
      return;
    }
    const target = focusAfterClose.current;
    if (target === null) return;
    focusAfterClose.current = null;
    if (target === "heading") titleRef.current?.focus();
    else leaveTriggers.current[target]?.focus();
  }, [confirmingLeave, groups]);

  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function post(
    url: string,
    body: unknown,
    fallbackError: string
  ): Promise<string | null> {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return null;
      const parsed = (await res.json().catch(() => ({}))) as { error?: string };
      return parsed.error ?? fallbackError;
    } catch {
      return fallbackError;
    }
  }

  async function createGroup(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (name.length === 0 || busy) return;
    setCreateError(null);
    setBusy("create");
    const failure = await post(
      "/api/groups",
      { name },
      "Couldn't create that group — try again."
    );
    if (!mounted.current) return;
    if (failure) {
      setCreateError(failure);
    } else {
      setNewName("");
      await reloadGroups();
    }
    if (mounted.current) setBusy(null);
  }

  async function joinGroup(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = inviteCodeFrom(code);
    if (trimmed.length === 0 || busy) return;
    setJoinError(null);
    setBusy("join");
    const failure = await post(
      "/api/groups/join",
      { code: trimmed },
      "Couldn't join right now — try again."
    );
    if (!mounted.current) return;
    if (failure) {
      setJoinError(failure);
    } else {
      setCode("");
      await reloadGroups();
    }
    if (mounted.current) setBusy(null);
  }

  async function leaveGroup(id: string) {
    setBusy(`leave-${id}`);
    setLeaveError(null);
    const failure = await post(
      `/api/groups/${id}/leave`,
      {},
      "Couldn't leave that group."
    );
    if (!mounted.current) return;
    setLeaveError(failure === null ? null : { groupId: id, message: failure });
    // Still a member on failure, so send focus back to the control that started it.
    focusAfterClose.current = failure ? id : "heading";
    setConfirmingLeave(null);
    await reloadGroups();
    if (mounted.current) setBusy(null);
  }

  async function copyInvite(group: GroupSummary) {
    try {
      await navigator.clipboard.writeText(inviteLink(group.inviteCode));
      if (mounted.current) setCopied(group.id);
    } catch {
      // Clipboard unavailable (insecure context, denied permission) — the link
      // is rendered in full above the button, so it stays selectable by hand.
    }
  }

  if (!user) return null;

  const fieldClasses =
    "min-h-11 w-full rounded-control border border-ash bg-charcoal px-md text-base text-cream placeholder:text-ash";
  // Outline is the default control here; amber fill marks the one primary action
  // on the page, matching the hub's primary/secondary pairing.
  const submitClasses =
    `min-h-11 shrink-0 px-lg text-base font-medium ${outlinedControlClasses} disabled:opacity-50`;
  const primaryClasses =
    "min-h-11 shrink-0 rounded-control bg-amber px-lg text-base font-semibold text-midnight transition-colors duration-100 hover:bg-warm-white disabled:opacity-50";

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[680px] px-md pb-4xl pt-2xl">
      <h1 ref={titleRef} tabIndex={-1} className="font-display text-[1.75rem]/[1.2] font-extrabold italic text-warm-white sm:text-[2.5rem]/[1.15]">
        Groups
      </h1>
      <p className="mt-md max-w-[52ch] text-base text-ash">
        A group is whoever&apos;s on the couch. Movie Night reads every member&apos;s
        saved taste profile before it recommends anything.
      </p>

      {/* One live region for the page: announcing from inside a button would
          collide with that button's own accessible-name change. */}
      <p role="status" className="sr-only">
        {copied === null
          ? ""
          : `Invite link for ${
              groups?.find((group) => group.id === copied)?.name ?? "the group"
            } copied`}
      </p>

      <section aria-labelledby="your-groups" className="mt-2xl">
        <h2 id="your-groups" className="sr-only">
          Your groups
        </h2>

        {groups === null ? (
          <>
            <p className="sr-only">Loading your groups…</p>
            <div aria-hidden="true" className="h-48 rounded-panel bg-charcoal" />
          </>
        ) : groups.length === 0 ? (
          <div className="rounded-panel border border-slate bg-charcoal p-lg">
            <p className="text-base font-medium text-cream">No groups yet.</p>
            <p className="mt-sm max-w-[52ch] text-sm text-ash">
              Start one and send the invite link to whoever you watch with — or
              paste a code someone already sent you. You can always watch solo
              without a group.
            </p>
          </div>
        ) : (
          <ul className="space-y-md">
            {groups.map((group) => (
              <li
                key={group.id}
                className="animate-rise-fade rounded-panel border border-slate bg-charcoal p-lg"
              >
                <div className="flex items-start justify-between gap-md">
                  <div className="min-w-0">
                    <h3 className="text-xl font-semibold text-cream">{group.name}</h3>
                    <p className="mt-2xs text-sm text-ash">
                      {group.members.map((member) => member.name).join(", ")}
                    </p>
                  </div>
                  <MemberAvatars members={group.members} />
                </div>

                <p className="mt-lg text-xs font-medium uppercase tracking-wider text-ash">
                  Invite link
                </p>
                <div className="mt-sm flex flex-col gap-sm sm:flex-row sm:items-center">
                  <span className="min-w-0 flex-1 truncate rounded-control border border-slate bg-midnight px-md py-sm text-sm tracking-wide text-cream">
                    {inviteLink(group.inviteCode)}
                  </span>
                  {/* The button reports its own outcome — no reserved row to
                      fill in, so nothing below it shifts when the label flips. */}
                  <button
                    type="button"
                    onClick={() => void copyInvite(group)}
                    aria-label={
                      copied === group.id
                        ? `Invite link for ${group.name} copied`
                        : `Copy invite link for ${group.name}`
                    }
                    className={`${submitClasses} ${
                      copied === group.id ? "border-sage text-sage" : ""
                    }`}
                  >
                    {copied === group.id ? "Copied" : "Copy"}
                  </button>
                </div>

                <div className="mt-lg border-t border-slate pt-md">
                  {confirmingLeave === group.id ? (
                    <div className="flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-cream">
                        Leave {group.name}? You&apos;ll need a new invite to come
                        back.
                      </p>
                      <span className="flex shrink-0 gap-sm">
                        <button
                          type="button"
                          ref={confirmRef}
                          onClick={() => void leaveGroup(group.id)}
                          disabled={busy !== null}
                          // Ember carries the destructive signal as the border;
                          // ember *text* on charcoal is only 4.1:1, under AA.
                          className="min-h-11 rounded-control border border-ember px-md text-sm font-medium text-cream transition-colors duration-100 hover:bg-ember hover:text-midnight disabled:opacity-50"
                        >
                          Yes, leave
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            focusAfterClose.current = group.id;
                            setConfirmingLeave(null);
                          }}
                          className="min-h-11 rounded-control px-md text-sm font-medium text-cream hover:text-warm-white"
                        >
                          Cancel
                        </button>
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      ref={(node) => {
                        leaveTriggers.current[group.id] = node;
                      }}
                      onClick={() => setConfirmingLeave(group.id)}
                      aria-label={`Leave group ${group.name}`}
                      className="inline-flex min-h-11 items-center text-sm font-medium text-ash transition-colors duration-100 hover:text-cream"
                    >
                      Leave group
                    </button>
                  )}
                  {leaveError?.groupId === group.id && confirmingLeave === null && (
                    <p role="alert" className="mt-sm text-sm text-ember">
                      {leaveError.message}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {listFailed && (
          <p role="alert" className="mt-sm text-sm text-ember">
            Couldn&apos;t load your groups — reload to try again.
          </p>
        )}
      </section>

      <div className="mt-2xl grid gap-xl sm:grid-cols-2">
        <section aria-labelledby="create-heading">
          <h2 id="create-heading" className="text-base font-semibold text-cream">
            Start a group
          </h2>
          <form onSubmit={createGroup} className="mt-md">
            <label htmlFor="group-name" className="block text-sm text-ash">
              Group name
            </label>
            <input
              id="group-name"
              type="text"
              value={newName}
              maxLength={50}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Sunday Nights"
              className={`${fieldClasses} mt-sm`}
            />
            <button
              type="submit"
              disabled={busy !== null}
              className={`${primaryClasses} mt-sm w-full`}
            >
              {busy === "create" ? "Creating…" : "Create group"}
            </button>
          </form>
          {createError && (
            <p role="alert" className="mt-sm text-sm text-ember">
              {createError}
            </p>
          )}
        </section>

        <section aria-labelledby="join-heading">
          <h2 id="join-heading" className="text-base font-semibold text-cream">
            Join with a code
          </h2>
          <form onSubmit={joinGroup} className="mt-md">
            <label htmlFor="invite-code" className="block text-sm text-ash">
              Invite code
            </label>
            <input
              id="invite-code"
              type="text"
              value={code}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setCode(event.target.value)}
              placeholder="aB23cdEF"
              className={`${fieldClasses} mt-sm tracking-wide`}
            />
            <button
              type="submit"
              disabled={busy !== null}
              className={`${submitClasses} mt-sm w-full`}
            >
              {busy === "join" ? "Joining…" : "Join group"}
            </button>
          </form>
          {joinError && (
            <p role="alert" className="mt-sm text-sm text-ember">
              {joinError}
            </p>
          )}
          <p className="mt-sm text-sm text-ash">
            Codes are case-sensitive.
          </p>
        </section>
      </div>

      <div className="mt-3xl border-t border-slate pt-lg">
        <Link
          href="/tonight"
          className="inline-flex min-h-11 items-center text-sm font-medium text-amber hover:text-warm-white"
        >
          Back to tonight
        </Link>
      </div>
    </main>
  );
}
