// ABOUTME: Account deletion — removes the user row while anonymizing records shared
// ABOUTME: with other group/session members instead of cascading their deletion.

import type { MatchingResponse } from "@/types/matching";

/** What a deleted user's name is replaced with everywhere it was persisted. */
export const DELETED_USER_LABEL = "[deleted user]";

/**
 * A name shorter than this is left out of the free-text pass: replacing every
 * standalone "A" would shred the prose it appears in.
 */
const MIN_FREE_TEXT_NAME_LENGTH = 2;

/**
 * Escapes a literal for use inside a RegExp. Deliberately narrower than the
 * common helper: escaping "-" or "/" is a SyntaxError under the "u" flag, so
 * the wider version would throw for a name like "Anne-Marie".
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces the user's name with DELETED_USER_LABEL in every persisted round of
 * every session they belong to — the structured tasteMap entry always, and the
 * four prose fields the model is told to write names into when it is safe to do
 * so. Operates on the parsed document, never on the serialized JSON, so it
 * cannot rewrite keys, other members' names, or unrelated values.
 *
 * The row set is bounded by (sessions the user belongs to) x (at most 10 rounds
 * each), so a sequential UPDATE per changed row is enough.
 */
async function scrubNameFromRounds(
  db: D1Database,
  userId: string,
  log: (line: string) => void
): Promise<void> {
  const user = await db
    .prepare("SELECT name FROM users WHERE id = ?")
    .bind(userId)
    .first<{ name: string | null }>();
  if (!user) return;
  const name = (user.name ?? "").trim();

  const { results } = await db
    .prepare(
      `SELECT r.id, r.ai_response FROM recommendations r
       JOIN session_members sm ON sm.session_id = r.session_id
       WHERE sm.user_id = ?`
    )
    .bind(userId)
    .all<{ id: string; ai_response: string }>();

  const pattern =
    name.length >= MIN_FREE_TEXT_NAME_LENGTH
      ? new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "giu")
      : null;

  for (const row of results) {
    let doc: MatchingResponse;
    try {
      doc = JSON.parse(row.ai_response) as MatchingResponse;
    } catch {
      log(JSON.stringify({ event: "scrub_unparseable_round", recommendationId: row.id }));
      continue;
    }

    let changed = false;
    const members = Array.isArray(doc?.tasteMap?.members) ? doc.tasteMap.members : [];

    for (const member of members) {
      if (member?.userId === userId && member.name !== DELETED_USER_LABEL) {
        member.name = DELETED_USER_LABEL;
        changed = true;
      }
    }

    // A surviving member with the same name turns a literal replacement into a
    // scrub of THEIR name out of THEIR own record. The structured field above
    // is keyed on userId and stays correct either way.
    const sharedWithSurvivor = members.some(
      (member) =>
        member?.userId !== userId &&
        typeof member?.name === "string" &&
        member.name.trim().toLowerCase() === name.toLowerCase()
    );

    if (pattern && sharedWithSurvivor) {
      log(JSON.stringify({ event: "scrub_name_shared_with_member", recommendationId: row.id }));
    } else if (pattern) {
      const scrub = (value: unknown): string | null => {
        if (typeof value !== "string") return null;
        const next = value.replace(pattern, DELETED_USER_LABEL);
        return next === value ? null : next;
      };

      const conversational = scrub(doc.conversational);
      if (conversational !== null) {
        doc.conversational = conversational;
        changed = true;
      }

      const overlapSummary = scrub(doc.tasteMap?.overlap?.summary);
      if (overlapSummary !== null) {
        doc.tasteMap.overlap.summary = overlapSummary;
        changed = true;
      }

      for (const member of members) {
        const summary = scrub(member?.summary);
        if (summary !== null) {
          member.summary = summary;
          changed = true;
        }
      }

      for (const rec of Array.isArray(doc?.recommendations) ? doc.recommendations : []) {
        const explanation = scrub(rec?.explanation);
        if (explanation !== null) {
          rec.explanation = explanation;
          changed = true;
        }
      }
    }

    if (!changed) continue;
    await db
      .prepare("UPDATE recommendations SET ai_response = ? WHERE id = ?")
      .bind(JSON.stringify(doc), row.id)
      .run();
  }
}

export async function deleteAccount(
  db: D1Database,
  userId: string,
  log: (line: string) => void = console.log
): Promise<void> {
  // Before the batch, which anonymizes the session_members join key the scrub
  // needs and deletes the users row the name is read from. It is also the safe
  // failure order: a partial scrub leaves the account undeleted and retryable.
  await scrubNameFromRounds(db, userId, log);

  // Per-row random sentinel: a fixed 'deleted' string would violate
  // UNIQUE(session_id, user_id) once a second member of the same session
  // deletes their account.
  await db.batch([
    db.prepare(
      "UPDATE session_members SET user_id = 'deleted-' || lower(hex(randomblob(4))) WHERE user_id = ?"
    ).bind(userId),
    db.prepare(
      "UPDATE movie_sessions SET initiated_by_user_id = 'deleted' WHERE initiated_by_user_id = ?"
    ).bind(userId),
    db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]);
}
