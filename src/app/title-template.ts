// ABOUTME: The one place the document-title suffix is spelled out, shared by the root
// ABOUTME: layout and any segment that has children of its own to pass it down to.

/**
 * Appends the app name to a segment's own title. A segment's template applies to
 * its children only, and a plain-string title carries no template — so any segment
 * with route segments beneath it has to restate this or its grandchildren lose the
 * suffix. Importing it keeps the two spellings from drifting apart.
 */
export const TITLE_TEMPLATE = "%s — Movie Night";

/** Title for surfaces that name no sub-page of their own — the landing page. */
export const SITE_NAME = "Movie Night";
