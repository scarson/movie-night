// ABOUTME: Privacy policy — plain-English static page covering the design-doc privacy principles.
// ABOUTME: What's collected and why, third-party disclosure (Anthropic, TMDB), deletion, contact.
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — Movie Night",
  description: "What Movie Night collects, why, and where it goes.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-[680px] px-md pb-3xl pt-2xl">
      <h1 className="font-display text-[2.5rem]/[1.15] font-extrabold text-warm-white">
        Privacy
      </h1>
      <p className="mt-lg text-xl/relaxed text-ash">
        Movie Night knows what you like to watch, which is more personal than
        it sounds. Here is everything the app collects, why it collects it,
        and where it goes — in plain English.
      </p>

      <section className="mt-2xl">
        <h2 className="font-display text-[1.75rem]/snug font-bold text-cream">
          What we collect, and why
        </h2>
        <ul className="mt-md list-disc space-y-md pl-lg text-base/relaxed text-cream marker:text-slate">
          <li>
            <strong className="font-semibold">Google account basics</strong>{" — "}
            your name, email address, and avatar, used only to sign you in. We
            never touch your contacts, calendar, or anything else in your
            Google account.
          </li>
          <li>
            <strong className="font-semibold">Your taste profile</strong>{" — "}
            comfort movies, watchlist, vibes, dealbreakers, and streaming
            services. This is the raw material the product runs on. It is
            visible to members of your group (that is the point) and to no one
            else.
          </li>
          <li>
            <strong className="font-semibold">Session data</strong>{" — "}mood
            selections, rough-day toggles, and the recommendations you
            receive, kept so the refinement loop and your group&apos;s history
            work.
          </li>
        </ul>
      </section>

      <section className="mt-2xl">
        <h2 className="font-display text-[1.75rem]/snug font-bold text-cream">
          What we never do
        </h2>
        <ul className="mt-md list-disc space-y-md pl-lg text-base/relaxed text-cream marker:text-slate">
          <li>
            No third-party analytics, no tracking pixels, no ad profiling, and
            no ads at all.
          </li>
          <li>No selling or sharing your data with third parties. Ever.</li>
        </ul>
      </section>

      <section className="mt-2xl">
        <h2 className="font-display text-[1.75rem]/snug font-bold text-cream">
          Where your data goes
        </h2>
        <ul className="mt-md list-disc space-y-md pl-lg text-base/relaxed text-cream marker:text-slate">
          <li>
            <strong className="font-semibold">Anthropic</strong>{" — "}when you ask
            for a match, your group&apos;s taste profiles and tonight&apos;s
            mood are sent to Claude, the AI that reasons about the overlap.
            Under Anthropic&apos;s commercial terms, this data is not used to
            train their models.
          </li>
          <li>
            <strong className="font-semibold">TMDB</strong>{" — "}we query The
            Movie Database for movie and show metadata only. No user data is
            ever sent to TMDB.
          </li>
        </ul>
      </section>

      <section className="mt-2xl">
        <h2 className="font-display text-[1.75rem]/snug font-bold text-cream">
          Deleting your account
        </h2>
        <p className="mt-md text-base/relaxed text-cream">
          Deleting your account removes all of your personal data. Records
          shared with your group — past sessions and recommendations — are
          anonymized instead of destroyed: your identity is replaced with
          &ldquo;[deleted user]&rdquo; so the group&apos;s history survives
          without you in it.
        </p>
      </section>

      <section className="mt-2xl">
        <h2 className="font-display text-[1.75rem]/snug font-bold text-cream">
          Questions
        </h2>
        <p className="mt-md text-base/relaxed text-cream">
          Write to{" "}
          <a
            href="mailto:samuel.carson@gmail.com"
            className="text-amber underline-offset-4 hover:underline"
          >
            samuel.carson@gmail.com
          </a>
          .
        </p>
      </section>
    </main>
  );
}
