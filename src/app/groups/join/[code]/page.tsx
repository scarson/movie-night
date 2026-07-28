// ABOUTME: Invite-link landing — confirm joining by CODE alone, then report the group.
// ABOUTME: The group name is never revealed before joining (no pre-join lookup exists).
"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { googleSignInUrl } from "@/components/auth-provider";

const PRIMARY_BUTTON =
  "flex min-h-12 w-full items-center justify-center rounded-control bg-amber px-xl text-base font-semibold text-midnight transition-colors duration-100 hover:bg-warm-white disabled:opacity-50 sm:w-auto";

export default function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const { user, loading } = useAuth();
  const [joined, setJoined] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const successRef = useRef<HTMLHeadingElement>(null);

  // The join button unmounts when the success screen replaces it, so focus is
  // handed to the new heading — it both announces the outcome and keeps the
  // keyboard user in place.
  useEffect(() => {
    if (joined) successRef.current?.focus();
  }, [joined]);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        id?: string;
        name?: string;
        error?: string;
      };
      if (res.ok && body.id && body.name) {
        setJoined({ id: body.id, name: body.name });
      } else {
        setError(body.error ?? "Couldn't join right now — try again.");
      }
    } catch {
      setError("Couldn't join right now — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[520px] px-md pb-4xl pt-3xl">
      {joined ? (
        <div className="animate-rise-fade">
          <h1 ref={successRef} tabIndex={-1} className="font-display text-[1.75rem]/[1.2] font-extrabold italic text-warm-white sm:text-[2.5rem]/[1.15]">
            You&apos;re in.
          </h1>
          <p className="mt-lg text-xl text-cream">{joined.name}</p>
          <p className="mt-sm max-w-[42ch] text-base text-ash">
            Fill in your taste profile when you get a moment — that&apos;s what
            Movie Night reads when it picks for the group.
          </p>
          <Link
            href="/tonight"
            className={`${PRIMARY_BUTTON} mt-2xl`}
          >
            Go to tonight
          </Link>
        </div>
      ) : (
        <>
          <h1 className="font-display text-[1.75rem]/[1.2] font-extrabold italic text-warm-white sm:text-[2.5rem]/[1.15]">
            Someone wants to watch with you.
          </h1>

          <p className="mt-xl text-xs font-medium uppercase tracking-wider text-ash">
            Invite code
          </p>
          <p className="mt-sm break-all rounded-panel border border-slate bg-charcoal px-lg py-md text-center text-[1.75rem] font-semibold tracking-[0.2em] text-amber tabular-nums [text-indent:0.2em]">
            {code}
          </p>

          {loading ? null : user ? (
            <>
              <p className="mt-lg max-w-[42ch] text-base text-ash">
                Joining adds you to the group and shares your taste profile with
                its other members. You can leave any time.
              </p>
              <button
                type="button"
                onClick={() => void join()}
                disabled={busy}
                className={`${PRIMARY_BUTTON} mt-lg`}
              >
                {busy ? "Joining…" : "Join this group"}
              </button>
            </>
          ) : (
            <>
              <p className="mt-lg max-w-[42ch] text-base text-ash">
                Sign in first — then you can confirm the join.
              </p>
              {/* A plain anchor, not next/link: this leaves the App Router for
                  an OAuth endpoint, so there is no client transition to make. */}
              <a
                href={googleSignInUrl(`/groups/join/${code}`)}
                className={`${PRIMARY_BUTTON} mt-lg`}
              >
                Sign in with Google
              </a>
            </>
          )}

          {error && (
            <p role="alert" className="mt-lg text-base text-ember">
              {error}
            </p>
          )}
        </>
      )}
    </main>
  );
}
