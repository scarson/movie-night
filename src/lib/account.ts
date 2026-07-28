// ABOUTME: Account deletion — removes the user row while anonymizing records shared
// ABOUTME: with other group/session members instead of cascading their deletion.

export async function deleteAccount(db: D1Database, userId: string): Promise<void> {
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
