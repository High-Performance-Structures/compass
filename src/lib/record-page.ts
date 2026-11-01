/**
 * One page of a growing record list that the server searches, sorts and
 * pages ("Record lists" in docs/development/ui-standards.md). The browser
 * sends a query and gets back the visible rows plus the matching total.
 */

const RECORD_PAGE_SIZES = [25, 50, 100] as const
const MAX_PAGE_INDEX = 10_000
const MAX_SEARCH_LENGTH = 100

export type RecordPageQuery = {
  readonly search: string
  /** A sort id from the list's own allowlist; null is the list's default order. */
  readonly sortId: string | null
  readonly sortDesc: boolean
  readonly pageIndex: number
  readonly pageSize: number
}

export type RecordPage<T> = {
  readonly rows: readonly T[]
  /** Rows matching the search and filters, across every page. */
  readonly total: number
}

export const DEFAULT_RECORD_PAGE_QUERY: RecordPageQuery = {
  search: "",
  sortId: null,
  sortDesc: false,
  pageIndex: 0,
  pageSize: RECORD_PAGE_SIZES[0],
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback
}

/** Validates an untrusted query against the list's sortable ids. */
export function parseRecordPageQuery(raw: unknown, sortIds: readonly string[]): RecordPageQuery {
  const value: Record<string, unknown> = typeof raw === "object" && raw !== null ? { ...raw } : {}
  const search = typeof value.search === "string" ? value.search.trim().slice(0, MAX_SEARCH_LENGTH) : ""
  const sortId = typeof value.sortId === "string" && sortIds.includes(value.sortId) ? value.sortId : null
  const pageSize = RECORD_PAGE_SIZES.find((size) => size === value.pageSize) ?? RECORD_PAGE_SIZES[0]
  const pageIndex = Math.min(Math.max(readNumber(value.pageIndex, 0), 0), MAX_PAGE_INDEX)
  return { search, sortId, sortDesc: sortId !== null && value.sortDesc === true, pageIndex, pageSize }
}

/** A LIKE pattern that matches `search` anywhere, with wildcards escaped (use ESCAPE '\'). */
export function containsPattern(search: string): string {
  return `%${search.toLowerCase().replace(/[\\%_]/g, (character) => `\\${character}`)}%`
}

/**
 * The digits of a phone-like search ("719 900-8850" -> "7199008850"), so a
 * number matches however it was typed. Null when the search is not a number.
 */
export function phoneDigitsPattern(search: string): string | null {
  if (!/^[\d\s().+-]+$/.test(search)) return null
  const digits = search.replace(/\D/g, "")
  return digits.length >= 3 ? `%${digits}%` : null
}
