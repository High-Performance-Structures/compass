/**
 * Kinds of browser-assembled documents a Print Preview snapshot can hold. Each
 * names the body class and root element its print styles in globals.css
 * expect, so the server renders the snapshot exactly as the browser printed it.
 */
export const PRINT_SNAPSHOT_KINDS = {
  "portal-report": {
    bodyClass: "selection-printing-selected",
    rootTag: "article",
    rootAttribute: "data-selection-print-root",
    rootClass: "selection-printable portal-report-printable",
    landscape: false,
  },
  "selection-packet": {
    bodyClass: "selection-printing-selected",
    rootTag: "article",
    rootAttribute: "data-selection-print-root",
    rootClass: "selection-printable bg-white text-black",
    landscape: false,
  },
  schedule: {
    bodyClass: "schedule-printing",
    rootTag: "section",
    rootAttribute: "data-project-schedule-print-document",
    rootClass: "schedule-print-document",
    landscape: true,
  },
  budget: {
    bodyClass: "owner-budget-printing",
    rootTag: "div",
    rootAttribute: "data-project-budget-print-root",
    rootClass: "owner-budget-print-root",
    landscape: true,
  },
} as const

export type PrintSnapshotKind = keyof typeof PRINT_SNAPSHOT_KINDS

export function isPrintSnapshotKind(value: string): value is PrintSnapshotKind {
  return Object.hasOwn(PRINT_SNAPSHOT_KINDS, value)
}

/** Large schedules and photo-heavy reports stay well under D1's row limit. */
export const PRINT_SNAPSHOT_MAX_HTML_LENGTH = 1_500_000
export const PRINT_SNAPSHOT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
