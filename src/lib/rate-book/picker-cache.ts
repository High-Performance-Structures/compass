import { getRateBookPicker, type RateBookPickerOption } from "@/app/actions/rate-book"

const TTL_MS = 60_000
type Entry = { readonly at: number; readonly promise: Promise<readonly RateBookPickerOption[]> }

let cache: ReadonlyMap<string, Entry> = new Map()

/**
 * One rate book request per project per minute, shared by every estimate line
 * that opens its breakdown (a long estimate would otherwise ask once per line).
 * Null loads the rate book alone, without a job's zone charges.
 */
export function loadRateBookPicker(projectId: string | null): Promise<readonly RateBookPickerOption[]> {
  const now = Date.now()
  const key = projectId ?? ""
  const hit = cache.get(key)
  if (hit && now - hit.at < TTL_MS) return hit.promise
  const promise = getRateBookPicker(projectId).then((result) => (result.success ? result.data : []))
  cache = new Map([...cache, [key, { at: now, promise }]])
  return promise
}
