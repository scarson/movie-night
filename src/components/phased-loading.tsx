// ABOUTME: Calm phased loading narrative — each phase holds ≥900ms while waiting;
// ABOUTME: once the response arrives, remaining phases fast-forward at 200ms each.
"use client";

import { useEffect, useRef, useState } from "react";

const DEFAULT_PHASES = [
  "Reading your tastes...",
  "Finding the overlap...",
  "Weighing tonight's mood...",
  "Choosing tonight's picks...",
];

const HOLD_MS = 900;
const FAST_FORWARD_MS = 200;

export interface PhasedLoadingProps {
  done: boolean;
  onComplete?: () => void;
  phases?: string[];
}

export function PhasedLoading({
  done,
  onComplete,
  phases = DEFAULT_PHASES,
}: PhasedLoadingProps) {
  const [index, setIndex] = useState(0);
  const [narrativeLanded, setNarrativeLanded] = useState(false);
  const doneRef = useRef(done);
  const onCompleteRef = useRef(onComplete);
  const completedRef = useRef(false);

  useEffect(() => {
    doneRef.current = done;
    onCompleteRef.current = onComplete;
  });

  // Each phase's hold length is fixed when the phase is entered: the opening
  // phase and any phase entered while still waiting hold the full 900ms (the
  // phase in flight when the response arrives finishes its hold); phases
  // entered after the response arrives fast-forward at 200ms.
  const lastIndex = phases.length - 1;
  useEffect(() => {
    const ms = index > 0 && doneRef.current ? FAST_FORWARD_MS : HOLD_MS;
    const timer = setTimeout(() => {
      if (index < lastIndex) {
        setIndex(index + 1);
      } else {
        setNarrativeLanded(true);
      }
    }, ms);
    return () => clearTimeout(timer);
  }, [index, lastIndex]);

  useEffect(() => {
    if (!narrativeLanded || !done || completedRef.current) return;
    completedRef.current = true;
    onCompleteRef.current?.();
  }, [narrativeLanded, done]);

  return (
    <div aria-live="polite" className="py-3xl text-center">
      <p
        key={index}
        className="animate-rise-fade font-display text-xl italic text-cream"
      >
        {phases[index]}
      </p>
    </div>
  );
}
