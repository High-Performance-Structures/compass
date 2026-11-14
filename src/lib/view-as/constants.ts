/*
 * Developer "View as" (approved 2026-11-13): admins in developer mode open a
 * live, read-only copy of another person's Compass to diagnose what they
 * report. Shared names only; pure and client-safe.
 *
 * Map of the feature:
 * - token.ts         signs and verifies the session cookie (tamper-proof)
 * - write-guard.ts   read-only D1/R2 wrappers used while viewing
 * - fetch-guard.ts   blocks outside writes and Gmail/Calendar reads while viewing
 * - request.ts       "does this request carry a View as cookie?" (server)
 * - policy.ts        who may use it (admins, company setting, developer mode)
 * - session.ts       resolves the viewed person's identity for getCurrentUser()
 * - audit.ts         Activity entries for start and end (never notifies)
 * - src/app/actions/view-as.ts            start, exit, person search
 * - src/components/view-as/*              top bar, search dialog, row actions
 */

/** httpOnly cookie holding the signed View as session. Its presence alone makes the request read only. */
export const VIEW_AS_COOKIE = "compass-view-as"

/** A View as session lasts at most this long; then the person is back to their own Compass. */
export const VIEW_AS_MAX_AGE_SECONDS = 4 * 60 * 60

/**
 * The cookie outlives the token by a day, so the middleware still sees an
 * expired session and records its end instead of the browser dropping it.
 */
export const VIEW_AS_COOKIE_MAX_AGE_SECONDS = VIEW_AS_MAX_AGE_SECONDS + 24 * 60 * 60

/** Records the end of a session the middleware found over, then returns to `?next=`. */
export const VIEW_AS_ENDED_PATH = "/view-as/ended"

/** Shown when a blocked write is attempted while viewing as someone. */
export const VIEW_AS_READ_ONLY_MESSAGE = "View as is read only. Exit View as to make changes."
