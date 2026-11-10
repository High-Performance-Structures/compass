/**
 * "Save to Compass" bookmarks-bar button: the pure parts. The bookmarklet
 * opens the save page in a small popup with the product page's address and
 * title; the page reads them back with `parseSaveToCompassQuery`. The origin
 * always comes from the deployment the person is using (never a fixed
 * domain), so the same button works for any company and the demo site.
 */
import { normalizeSupplierUrl } from "@/lib/selections/link-preview"
import type { ProjectSelectionItem } from "@/lib/domain/selections/types"

/** The popup page, relative to the deployment's origin. */
const SAVE_TO_COMPASS_PATH = "/save-to-compass"

const POPUP_NAME = "compassSave"
const POPUP_FEATURES = "width=480,height=680"
const TITLE_MAX = 300

/** Job statuses that can take new choices. */
const SAVE_TARGET_STATUSES: readonly string[] = ["OPEN", "WARRANTY"]

/** The deployment origin when it is a plain http(s) origin, otherwise null. */
function cleanOrigin(origin: string): string | null {
  try {
    const url = new URL(origin)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    return url.origin
  } catch {
    return null
  }
}

/**
 * The `javascript:` bookmarklet for the given deployment origin, or null when
 * the origin is not http(s). The origin is embedded as a JSON string literal so
 * it can never break out of the script.
 */
export function buildSaveToCompassBookmarklet(origin: string): string | null {
  const base = cleanOrigin(origin)
  if (!base) return null
  const target = JSON.stringify(`${base}${SAVE_TO_COMPASS_PATH}`)
  const script =
    `(function(){window.open(${target}+"?url="+encodeURIComponent(location.href)+"&title="+encodeURIComponent(document.title),` +
    `${JSON.stringify(POPUP_NAME)},${JSON.stringify(POPUP_FEATURES)})})()`
  return `javascript:${script}`
}

type QueryValue = string | readonly string[] | undefined

function firstValue(value: QueryValue): string {
  if (typeof value === "string") return value
  return value?.[0] ?? ""
}

export type SaveToCompassQuery =
  | { readonly ok: true; readonly url: string; readonly title: string }
  | { readonly ok: false; readonly error: string }

/** Reads and checks the popup's `url` and `title` query values. */
export function parseSaveToCompassQuery(query: { readonly url?: QueryValue; readonly title?: QueryValue }): SaveToCompassQuery {
  const raw = firstValue(query.url).trim()
  if (!raw) return { ok: false, error: "No product page was sent. Open a product page and click the Save to Compass button." }
  const url = normalizeSupplierUrl(raw)
  if (!url) return { ok: false, error: "This page can't be saved. Only public web pages that start with http:// or https:// can be saved." }
  const title = firstValue(query.title).replace(/\s+/g, " ").trim().slice(0, TITLE_MAX)
  return { ok: true, url, title }
}

/** True for jobs that take new choices (open or in warranty). */
export function isSaveTargetStatus(status: string | null | undefined): boolean {
  return SAVE_TARGET_STATUSES.includes((status ?? "").trim().toUpperCase())
}

export type SaveTargetSelection = {
  readonly id: string
  readonly name: string
  readonly roomName: string
  readonly category: string
}

/** A job's selections, room by room, for the selection picker. */
export function saveTargetSelections(
  rooms: readonly { readonly roomName: string; readonly selections: readonly Pick<ProjectSelectionItem, "id" | "name" | "roomName" | "category">[] }[],
): readonly SaveTargetSelection[] {
  return rooms.flatMap((room) =>
    room.selections.map((selection) => ({
      id: selection.id,
      name: selection.name,
      roomName: selection.roomName || room.roomName,
      category: selection.category,
    })),
  )
}

/** The choice title to prefill: the page's preview title, else the page's own title. */
export function prefilledChoiceTitle(previewTitle: string | null, pageTitle: string): string {
  return (previewTitle ?? "").trim() || pageTitle.trim()
}

/** Cents as the dollars text a price field takes ("1249.99"), or "" for none. */
export function centsToPriceInput(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2)
}
