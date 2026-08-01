# The `users.name` scrub collateral — exposure, options, recommendation

**Date:** 2026-08-01
**Status:** ANALYSIS ONLY. No code was changed. The remedies that actually close this touch the
data model or the prompt contract, which is Sam's call.
**Provenance:** Tier 2 item 5 in `dev/handoff-2026-08-01.md`. Surfaced by the G3 agent during the
B5 remediation (`dev/research/2026-08-01-remediation-decisions.md` §12), which deliberately declined
to paper over it with a heuristic. That was the right call, and this document explains why the
obvious heuristics do not work.

---

## 1. What the code does

`scrubNameFromRounds` (`src/lib/account.ts:34-133`) runs once, before the deletion batch, and:

1. reads the departing user's `users.name`;
2. selects every `recommendations` row reachable by
   `JOIN session_members sm ON sm.session_id = r.session_id WHERE sm.user_id = ?` — i.e. **every
   round of every session the user was a member of, across every group**;
3. rewrites `tasteMap.members[].name` for their own entry (keyed on `userId`, always exact);
4. builds `new RegExp("(?<![\\p{L}\\p{N}])" + escaped(name) + "(?![\\p{L}\\p{N}])", "giu")` and
   replaces every match with `[deleted user]` in four prose fields: `conversational`,
   `tasteMap.overlap.summary`, **every** member's `tasteMap.members[].summary` (not only the
   departing member's), and every `recommendations[].explanation`;
5. writes the mutated document back with `UPDATE recommendations SET ai_response = ?`.

Step 5 is destructive and unlogged: the pre-scrub text is not retained anywhere.

Two guards exist. Neither addresses this.

- **`MIN_FREE_TEXT_NAME_LENGTH = 2`** (`account.ts:13`) suppresses the free-text pass only for
  one-character names. `"An"`, `"Is"`, `"It"`, `"Of"`, `"To"`, `"Up"`, `"The"`, `"And"` all clear it.
- **`sharedWithSurvivor`** (`account.ts:82-90`) suppresses the free-text pass when a *surviving
  member of that same round* has the same display name. It compares against
  `tasteMap.members[].name` only. A common English word is not a member name, so the guard never
  fires for the case in question.

The name itself is refreshed from Google on **every** sign-in: the callback's upsert runs
`ON CONFLICT(google_id) DO UPDATE SET ... name = excluded.name`
(`src/app/api/auth/google/callback/route.ts:125-127`), taking the `name` claim from the ID token
verbatim. Nothing in the app validates, clamps, or normalises it on the way into `users.name`; the
only clamp anywhere is `MAX_NAME_CHARS = 50` applied at prompt-build time (`matching.ts:16, 331`).

## 2. The exposure, precisely

**Who can do it.** Any authenticated account that is (a) a member of a group and (b) present in at
least one session of that group that produced a round. Group membership is invite-code gated
(`src/lib/groups.ts:111`), so the actor is someone a victim deliberately invited. Changing a Google
display name is free and unlimited; the app has no display-name field of its own.

**Against whom.** Every other member of every session the actor participated in. The `member.summary`
loop scrubs *all* members' summaries, so the survivors' own taste-map prose is in range, not just
the departing user's.

**What the damage is.** Prose vandalism, irreversible. The word chosen as a display name is replaced
by the literal string `[deleted user]` throughout the four prose fields of every affected round. With
a name like `"The"` the surviving history is destroyed as text; with `"Will"` or `"May"` it is
garbled in a way that reads as a product bug. The `giu` flags make the match case-insensitive, so
lower-case occurrences go too, and the lookbehind/lookahead exclude only `\p{L}\p{N}` — so `"It"`
also matches inside `It's`.

**What the damage is not.** No confidentiality impact: the actor reads nothing they could not
already read as a member. No privilege escalation, no cross-group reach beyond groups they were
invited into, no effect on titles, profiles, groups, or session structure. Nothing is deleted — the
rounds survive, altered.

**Cost to the actor.** They lose their own account, and re-entry needs a fresh invite code from a
victim (join attempts are rate-limited to 10 per 10 minutes, `groups.ts:14-16`). This is a
one-shot, self-destructive act of griefing by an insider — not a scalable or repeatable attack.

**The likelier path is accidental, not adversarial.** `Will`, `Grace`, `May`, `June`, `Art`, `Rose`,
`Mark`, `Bill`, `Hope`, `Joy`, `Faith`, `Dawn`, `Sky`, `Angel`, `Chase`, `Drew`, `Sunny` are
ordinary given names and ordinary English words. So are many transliterated names. The prompt
explicitly instructs the model to "Reference members by name" in `conversational`
(`matching.ts:314-315`), so the prose reliably contains both the legitimate occurrences and the
incidental ones. A user called Will deleting their account is the expected case, and it produces
exactly the failure: `"you will love this"` becomes `"you [deleted user] love this"`. No
attacker is required, and there is no signal that would let support tell the two apart afterwards.

**Severity.** Low as a security finding (insider-only, self-destructive, integrity-only, invite-gated,
bounded blast radius). Medium as a product-correctness finding, because the accidental case is
common, silent, and irreversible.

## 3. Options

### A. Accept, unchanged

**Cost:** none. **Leaves:** garbled history for common-word names, irreversibly, with no
diagnosability. Defensible strictly as a security posture; weak as a product answer, because the
accidental case will look like a bug to the person it happens to and nobody will be able to explain
it.

### B. Bound the replacement to prose the departing user's own rounds produced

Named in the Tier 2 brief. **It does not narrow anything.** The row set is already exactly the
rounds of the sessions they were a member of, and every one of those rounds is jointly about all
members — the prose is one `conversational` string per round, not per person. The only narrower set
reachable without a schema change is "sessions this user created", which is arbitrary (it exempts
every session their partner started, which is half of them) and leaves the privacy promise unmet in
the common case. Rejected on inspection.

### C. Require the name to be distinctive (stop-word / dictionary / shape heuristic)

Skip the free-text pass when the name looks like a common word, or require the occurrence to be
capitalised and not sentence-initial.

**Cost:** a word list (English-only, in an app whose users are global), plus permanent maintenance.
**Why it fails:** the error is two-directional and the two directions are the same words. `Rose`,
`Will`, `May`, `Mark` are simultaneously real given names and common words. A list that protects the
prose stops scrubbing real names — silently breaking the privacy promise for exactly the users whose
names are most common. A list that keeps scrubbing them does not fix the bug. Capitalisation shape
fails on sentence-initial `Will`, on lower-cased model output, and on names that are legitimately
lower-case. This is the heuristic G3 declined to build, and declining was correct.

### D. Stop putting names into stored prose — resolve them at render time

Change the prompt contract so the model writes a stable per-member reference into prose (e.g.
`{{member:<userId>}}`) instead of a literal name, validate it in `isMatchingResponse`, and have the
renderer substitute the member's current display name — or `[deleted user]` when the member is gone.

**What it buys:** deletion needs no text rewriting at all, so the collateral disappears by
construction rather than by heuristic; the scrub becomes a no-op and `account.ts` loses its most
delicate code; it is exact for every name including one-character ones, so
`MIN_FREE_TEXT_NAME_LENGTH` and `sharedWithSurvivor` both go away; two members with the same name
stop being a special case; and it incidentally fixes a bug nobody has filed — a member who *changes*
their display name today keeps the old one frozen in every past round's prose forever.

**What it costs:** a prompt change and a `PROMPT_VERSION` bump; a validator plus a fallback for
non-compliant model output (the model will sometimes write the bare name anyway, so the delete-time
scrub has to stay as a backstop, though it would then be a rare path rather than the mechanism); a
renderer change in `conversational-view.tsx`, `taste-map.tsx` and `ranked-list.tsx`; and a live eval
re-run to measure compliance.

**Timing argument.** The eval re-run is already an open, mandatory gate — `PROMPT_VERSION` moved to
`p1.1` and the existing eval results are stale (`dev/handoff-2026-08-01.md` Tier 3 item 9). A prompt
change made now rides a re-run that has to happen anyway. And there are **zero production rounds**:
nothing is deployed, migrations `0002`–`0004` are unapplied, so there is no back-fill problem. This
is the cheapest this fix will ever be.

**Lighter variant (D-lite).** Instruct the model to delimit member names in prose (e.g. bold or a
sentinel) without full placeholder resolution, and scrub only inside the delimiters. Same prompt +
eval cost, keeps stale names frozen, and still fails open when the model forgets the delimiter. It
is cheaper only in renderer work, which is the small part. Not worth the compromise.

### E. Preserve the pre-scrub text so the rewrite is reversible

Rejected: retaining the original defeats the promise the scrub exists to keep, and it does not stop
the survivor from seeing garbled prose in the meantime.

## 4. Recommendation

**Take D**, scheduled to land with the already-required eval re-run and before any deploy. Making
names structured rather than baked into prose is the only option that removes the collateral by
construction, and it is the only one that also fixes stale names after a rename. The delete-time
scrub stays as a backstop for non-compliant model output, unchanged, with its existing guards —
demoted from mechanism to fallback, where the collateral it can cause is rare rather than routine.

**If D is deferred, take A — accept and say so — not C.** A heuristic word list would convert a
visible, explainable garbling bug into a silent privacy-promise failure for the users with the
commonest names, which is a strictly worse trade. If A is chosen, one cheap non-heuristic addition is
worth making alongside it: have `scrubNameFromRounds` log a per-round replacement count next to the
existing `scrub_name_shared_with_member` line, so a support case is diagnosable after the fact. That
changes no semantics and does not pre-empt D.

## 5. What the earlier passes got wrong

- The Tier 2 brief and the handoff both attribute the containment to the **2-character floor**. The
  floor stops one-character names only; the guard that actually fires in practice is
  `sharedWithSurvivor`, and it fires only on a *member-name* collision, which is not the case at
  issue. Neither guard touches common-word names.
- The brief's suggested remedy "bound replacement to prose the departing user's own rounds produced"
  does not exist as a narrowing — see §3.B.
- Both the handoff and §12 of the decision record describe the risk as adversarial ("someone could
  set their display name to a common short word"). The adversarial case is the *less* likely one and
  the less costly one, because it is insider-only and self-destructive. The accidental case — an
  ordinary user named Will or Grace — has the same blast radius, needs no intent, and is the one
  that will actually be reported.
