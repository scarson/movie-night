// ABOUTME: Tonight's results — taste map, ranked picks and the write-up behind three
// ABOUTME: tabs, plus the refinement loop. Never re-runs the persisted round on mount.
"use client";

import { Suspense, use, useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { PhasedLoading } from "@/components/phased-loading";
import { TasteMap } from "@/components/taste-map";
import { RankedList, type Rating } from "@/components/ranked-list";
import { ConversationalView } from "@/components/conversational-view";
import { RefinePanel } from "@/components/refine-panel";
import { primaryButtonClasses } from "@/components/control-classes";
import { framingFor } from "@/lib/match-errors";
import {
  fetchSessionResults,
  runMatchRound,
  type SessionResults,
} from "@/lib/session-flow";

/** Matches MAX_ROUNDS_PER_SESSION in the match route. */
const MAX_ROUNDS = 10;
/** Matches MAX_ID_LIST_ENTRIES in the match route — over this it 400s. */
const MAX_ID_LIST_ENTRIES = 50;
/** Enough to set the scene; the full list belongs on the mood screen, not here. */
const MAX_VIBES_IN_STRAPLINE = 3;

const TABS = [
  { id: "map", label: "Taste map" },
  { id: "picks", label: "The picks" },
  { id: "words", label: "In words" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function Results({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const { user, loading } = useAuth();
  const router = useRouter();

  const [results, setResults] = useState<SessionResults | null>(null);
  const [loadError, setLoadError] = useState<"missing" | "error" | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [tab, setTab] = useState<TabId>("map");
  const [ratings, setRatings] = useState<Record<number, Rating>>({});
  const [carriedRemoved, setCarriedRemoved] = useState<number[]>([]);
  const [steering, setSteering] = useState("");
  const [busy, setBusy] = useState(false);
  const [roundDone, setRoundDone] = useState(false);
  const [refineError, setRefineError] = useState<{ message: string; kind: string | null } | null>(
    null
  );

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const errorHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const tabBaseId = useId();

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const loaded = await fetchSessionResults(sessionId);
      if (cancelled) return;
      if (loaded.status === "ok") {
        setResults(loaded.results);
        return;
      }
      setLoadError(loaded.status);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, sessionId, reloadNonce]);

  // The control that failed is inside the panel that just changed; without this
  // the keyboard user is left on <body> with no idea anything happened. `busy`
  // is in the deps because the failure lands while the loading narrative still
  // owns the screen — the heading does not exist to focus until it clears.
  useEffect(() => {
    if (refineError !== null && !busy) errorHeadingRef.current?.focus();
  }, [refineError, busy]);

  const runRound = useCallback(
    async (input: { keptTmdbIds: number[]; removedTmdbIds: number[]; steeringFeedback: string }) => {
      setRefineError(null);
      setRoundDone(false);
      setBusy(true);
      const { data, error, kind } = await runMatchRound(sessionId, input);
      if (data !== null) {
        setResults((prev) =>
          prev === null
            ? null
            : { ...prev, round: data.round, response: data.response, titles: data.titles }
        );
        setCarriedRemoved(input.removedTmdbIds);
        setRatings({});
        setSteering("");
      } else {
        setRefineError({ message: error ?? "Something went wrong.", kind });
      }
      setRoundDone(true);
    },
    [sessionId]
  );

  if (!user) return null;

  if (loadError === "missing") {
    return (
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[680px] px-md pb-4xl pt-2xl">
        <h1 className="font-display text-[1.75rem]/[1.2] font-extrabold italic text-warm-white">
          We can&apos;t find tonight&apos;s picks
        </h1>
        <p className="mt-md max-w-[62ch] text-base text-cream">
          This session either doesn&apos;t exist or isn&apos;t yours to see. Starting a
          fresh one takes a few seconds.
        </p>
        <Link href="/tonight" className={`${primaryButtonClasses} mt-xl w-fit`}>
          Back to tonight
        </Link>
      </main>
    );
  }

  if (loadError === "error") {
    return (
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[680px] px-md pb-4xl pt-2xl">
        <h1 className="font-display text-[1.75rem]/[1.2] font-extrabold italic text-warm-white">
          We couldn&apos;t reach tonight&apos;s picks
        </h1>
        <p role="alert" className="mt-md max-w-[62ch] text-base text-cream">
          That looked like a connection blip, not a missing session — give it another
          go.
        </p>
        <div className="mt-xl flex flex-col gap-sm sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => {
              setLoadError(null);
              setReloadNonce((n) => n + 1);
            }}
            className={primaryButtonClasses}
          >
            Try again
          </button>
          <Link
            href="/tonight"
            className="inline-flex min-h-12 items-center text-base font-medium text-amber hover:text-warm-white"
          >
            Back to tonight
          </Link>
        </div>
      </main>
    );
  }

  if (results === null) {
    return (
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[680px] px-md pb-4xl pt-2xl" aria-busy="true">
        <div className="h-8 w-48 rounded-tag bg-charcoal" />
        <div className="mt-lg h-4 w-64 rounded-tag bg-charcoal" />
        <span className="sr-only">Loading tonight&apos;s picks</span>
      </main>
    );
  }

  const { session, round, response, titles } = results;

  // Kept/removed follow the printed order, so what we send matches what was read.
  const recommendations = response?.recommendations ?? [];
  // Capped for the same reason as the removed list: the schema puts no ceiling
  // on how many recommendations come back, and the route rejects over 50.
  const keptTmdbIds = recommendations
    .filter((rec) => ratings[rec.tmdbId] === "kept")
    .map((rec) => rec.tmdbId)
    .slice(0, MAX_ID_LIST_ENTRIES);
  const removedThisRound = recommendations
    .filter((rec) => ratings[rec.tmdbId] === "removed")
    .map((rec) => rec.tmdbId);
  // The server unions these with every prior round's exclusions too; sending
  // them keeps the list right even if a round was run from another device.
  const removedTmdbIds = [...new Set([...carriedRemoved, ...removedThisRound])].slice(
    -MAX_ID_LIST_ENTRIES
  );

  const regenerate = () =>
    void runRound({ keptTmdbIds, removedTmdbIds, steeringFeedback: steering.trim() });

  // Membership is only observable from a refusal — the read path still serves an
  // ex-member — so it is derived here rather than fetched, and gates every control
  // that posts to the match route. The no-round branch below has one of its own.
  const leftGroup = refineError?.kind === "left_group";

  if (busy) {
    return (
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[680px] px-md pb-4xl pt-2xl">
        <PhasedLoading done={roundDone} onComplete={() => setBusy(false)} />
      </main>
    );
  }

  // A session can exist without a round: the flow that created it failed at the
  // match step. Matching is an explicit choice here, never an on-mount side effect.
  if (response === null || round === 0) {
    return (
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[680px] px-md pb-4xl pt-2xl">
        <h1 className="font-display text-[1.75rem]/[1.2] font-extrabold italic text-warm-white">
          Nothing picked yet
        </h1>
        <p className="mt-md max-w-[62ch] text-base text-cream">
          This session was set up but never matched. Everything we need is saved —
          it just needs a run.
        </p>
        {refineError !== null && (
          <div role="alert" className="mt-lg">
            <h2
              ref={errorHeadingRef}
              tabIndex={-1}
              data-testid="refine-error-heading"
              className="font-display text-xl font-semibold text-warm-white"
            >
              {framingFor(refineError.kind).heading}
            </h2>
            <p className="mt-2xs max-w-[62ch] break-words text-base text-cream">{refineError.message}</p>
          </div>
        )}
        <div className="mt-xl flex flex-col gap-sm sm:flex-row sm:items-center">
          <button
            type="button"
            disabled={leftGroup}
            onClick={() => void runRound({ keptTmdbIds: [], removedTmdbIds: [], steeringFeedback: "" })}
            className={`${primaryButtonClasses} w-full sm:w-auto`}
          >
            Find our match →
          </button>
          <Link
            href="/tonight"
            className="inline-flex min-h-12 items-center text-base font-medium text-amber hover:text-warm-white"
          >
            Back to tonight
          </Link>
        </div>
      </main>
    );
  }

  const moveTab = (event: React.KeyboardEvent, index: number) => {
    const last = TABS.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  const framing = refineError === null ? null : framingFor(refineError.kind);
  const exhausted = refineError?.kind === "round_limit";

  // The ritual's tag picker is unbounded, so the strapline takes the first few
  // rather than reciting the whole list back.
  const moodLine =
    session.moodVibes.length > 0
      ? `Read against tonight's ${session.moodVibes
          .slice(0, MAX_VIBES_IN_STRAPLINE)
          .join(", ")
          .toLowerCase()} mood.`
      : "Read from your saved profiles.";

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[680px] px-md pb-4xl pt-2xl">
      <h1 className="font-display text-[1.75rem]/[1.2] font-extrabold italic text-warm-white sm:text-[2.5rem]/[1.15]">
        Tonight, then.
      </h1>
      <p className="mt-sm max-w-[62ch] break-words text-base text-ash">{moodLine}</p>

      <div
        role="tablist"
        aria-label="Result views"
        className="mt-2xl flex gap-lg border-b border-slate"
      >
        {TABS.map((entry, index) => {
          const selected = entry.id === tab;
          return (
            <button
              key={entry.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${tabBaseId}-${entry.id}`}
              aria-selected={selected}
              aria-controls={`${tabBaseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(entry.id)}
              onKeyDown={(event) => moveTab(event, index)}
              className={`-mb-px min-h-11 border-b-2 pb-sm text-base transition-colors duration-100 ${
                selected
                  ? "border-amber font-medium text-warm-white"
                  : "border-transparent text-ash hover:text-cream"
              }`}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${tabBaseId}-panel`}
        aria-labelledby={`${tabBaseId}-${tab}`}
        tabIndex={tab === "picks" ? undefined : 0}
        className="mt-2xl"
      >
        {tab === "map" && (
          <TasteMap
            tasteMap={response.tasteMap}
            // Only ever the viewer's own flag, and deliberately blind to
            // everyone else's. The note describes the viewer's own request, so
            // it needs no knowledge of the engine's outcome — and gating it on
            // that outcome would tell a toggler whether their partner toggled
            // too. The member guard keeps it off a session where "everyone
            // else" is nobody.
            showWeightingNote={session.roughDay && response.tasteMap.members.length > 1}
          />
        )}
        {tab === "picks" && (
          <RankedList
            recommendations={response.recommendations}
            titles={titles}
            ratings={ratings}
            onRatingsChange={setRatings}
          />
        )}
        {tab === "words" && <ConversationalView text={response.conversational} />}
      </div>

      {refineError !== null && framing !== null && (
        <div
          role="alert"
          className="mt-2xl rounded-panel border border-ember p-lg"
        >
          <h2
            ref={errorHeadingRef}
            tabIndex={-1}
            data-testid="refine-error-heading"
            className="font-display text-xl font-semibold text-warm-white"
          >
            {framing.heading}
          </h2>
          <p className="mt-2xs max-w-[62ch] break-words text-base text-cream">{refineError.message}</p>
          <div className="mt-md flex flex-wrap gap-sm">
            {framing.retry && (
              <button type="button" onClick={regenerate} className={primaryButtonClasses}>
                Try again
              </button>
            )}
            {framing.loosen === true && (
              <Link href="/profile" className={primaryButtonClasses}>
                Edit your dealbreakers
              </Link>
            )}
          </div>
        </div>
      )}

      <RefinePanel
        round={round}
        maxRounds={MAX_ROUNDS}
        keptCount={keptTmdbIds.length}
        removedCount={removedThisRound.length}
        carriedRemovedCount={carriedRemoved.length}
        steering={steering}
        onSteeringChange={setSteering}
        onRegenerate={regenerate}
        onStartOver={() => router.push("/tonight")}
        exhausted={exhausted}
        leftGroup={leftGroup}
      />
    </main>
  );
}

export default function ResultsPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <Results params={params} />
    </Suspense>
  );
}
