/**
 * Pure correspondence rules shared by the store and its callers. No database
 * or network access.
 */

/**
 * SQLite's default trim removes only spaces. Passing these characters to
 * `trim(x, chars)` matches JavaScript's `String.prototype.trim`, which the
 * composer uses.
 */
export const JS_TRIM_CHARACTERS =
  "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

export type InboxStateAction = "save" | "unsave" | "follow-up" | "clear-follow-up" | "archive" | "restore"

export type InboxStatePatch =
  | { readonly saved: boolean }
  | { readonly followUp: boolean }
  | { readonly archived: boolean }

/** The one inbox flag an inbox action changes. */
export function inboxStatePatch(action: InboxStateAction): InboxStatePatch {
  if (action === "save" || action === "unsave") return { saved: action === "save" }
  if (action === "follow-up" || action === "clear-follow-up") return { followUp: action === "follow-up" }
  return { archived: action === "archive" }
}
