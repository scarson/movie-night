// ABOUTME: Landing page — editorial hook, miniature taste-map vignette, Google sign-in CTA.
// ABOUTME: Signed-in visitors are redirected to /tonight; signed-out visitors see the pitch.
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { primaryControlClasses } from "@/components/control-classes";

const STARFIELD = {
  backgroundImage: [
    "radial-gradient(ellipse 60% 40% at 70% 0%, var(--amber-glow), transparent 70%)",
    "radial-gradient(1px 1px at 12% 18%, rgba(245, 240, 232, 0.28), transparent 100%)",
    "radial-gradient(1px 1px at 34% 62%, rgba(245, 240, 232, 0.16), transparent 100%)",
    "radial-gradient(1.5px 1.5px at 58% 31%, rgba(245, 240, 232, 0.22), transparent 100%)",
    "radial-gradient(1px 1px at 79% 74%, rgba(245, 240, 232, 0.18), transparent 100%)",
    "radial-gradient(1px 1px at 91% 12%, rgba(245, 240, 232, 0.24), transparent 100%)",
    "radial-gradient(1.5px 1.5px at 22% 88%, rgba(245, 240, 232, 0.14), transparent 100%)",
    "radial-gradient(1px 1px at 47% 8%, rgba(245, 240, 232, 0.2), transparent 100%)",
  ].join(", "),
};

export default function Home() {
  const { user, loading, signIn } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace("/tonight");
    }
  }, [loading, user, router]);

  return (
    <div className="relative overflow-hidden">
      <div aria-hidden="true" className="absolute inset-0" style={STARFIELD} />
      <main id="main" tabIndex={-1} className="relative mx-auto w-full max-w-[680px] px-md pb-4xl pt-3xl">
        <h1 className="animate-rise-fade max-w-[14ch] font-display text-[2.5rem]/[1.15] font-extrabold italic text-warm-white sm:text-[3.5rem]/[1.1]">
          What should we watch tonight?
        </h1>
        <p className="mt-lg max-w-[42ch] animate-rise-fade text-xl/relaxed text-ash [animation-delay:80ms]">
          Ask something that knows you both. Movie Night reads two tastes, one
          mood, and finds the film in the middle.
        </p>

        <section
          aria-label="A taste map, in miniature"
          className="mt-3xl animate-rise-fade border-y border-slate py-xl [animation-delay:160ms]"
        >
          <p className="font-display text-base italic text-ash">
            A taste map, in miniature
          </p>
          <div className="mt-lg space-y-md text-base/relaxed text-cream">
            <p>
              <span className="font-semibold text-person-a">Alice</span> keeps
              returning to slow-burn science fiction — films that trust her to
              wait.
            </p>
            <p>
              <span className="font-semibold text-person-b">Bob</span> wants
              warmth on a weeknight: comedies with heart, nothing cruel.
            </p>
            <p>
              Where they overlap:{" "}
              <span className="font-semibold text-overlap">
                wry, human, a little strange
              </span>
              . Tonight that looks like{" "}
              <em className="font-display font-semibold not-italic text-warm-white">
                Arrival
              </em>{" "}
              <span className="tabular-nums text-ash">— 92% match.</span>
            </p>
          </div>
        </section>

        <div className="mt-2xl animate-rise-fade [animation-delay:240ms]">
          <button
            type="button"
            onClick={() => signIn("/tonight")}
            className={`inline-flex min-h-12 items-center px-xl text-base font-semibold ${primaryControlClasses}`}
          >
            Sign in with Google
          </button>
          <p className="mt-md max-w-[42ch] text-sm text-ash">
            A two-minute ritual: saved profiles, tonight&apos;s mood, and a
            shortlist you can both live with — before the popcorn&apos;s done.
          </p>
        </div>
      </main>
    </div>
  );
}
