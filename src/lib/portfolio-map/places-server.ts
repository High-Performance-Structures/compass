import { addressState } from "@/lib/geo/site-lookup"
import { getCloudflareContext } from "@/lib/db"
import { COLORADO_PLACES, parsePlaceIndex, type PlaceIndex } from "@/lib/portfolio-map/model"
import { isMapStateCode, mapStateName, type MapStateCode } from "@/lib/portfolio-map/states"

// Loaded at most once per worker instance; each file is 5-135 KB.
const loaded = new Map<MapStateCode, Promise<PlaceIndex | null>>()

async function readPlaceFile(state: MapStateCode): Promise<unknown> {
  const path = `/maps/places/${state.toLowerCase()}-v1.json`
  const { env } = await getCloudflareContext()
  const response = await env.ASSETS?.fetch(new Request(`https://assets.local${path}`)).catch(() => null)
  if (response?.ok) return response.json()
  // Local development has no assets binding: read the same file from public/.
  if (process.env.NODE_ENV !== "production" || process.env.COMPASS_E2E === "true") {
    const { readFile } = await import("node:fs/promises")
    return JSON.parse(await readFile(`${process.cwd()}/public${path}`, "utf8"))
  }
  throw new Error(`place file ${response?.status ?? "unavailable"}`)
}

/** A state's towns and ZIP codes, or null when they can't be loaded. */
function loadPlaceIndex(state: MapStateCode): Promise<PlaceIndex | null> {
  if (state === "CO") return Promise.resolve(COLORADO_PLACES)
  const cached = loaded.get(state)
  if (cached) return cached
  const pending = readPlaceFile(state)
    .then((value) => parsePlaceIndex(value, [state, mapStateName(state)]))
    .catch((error: unknown) => {
      console.error("Place lookup unavailable", state, error instanceof Error ? error.message : error)
      loaded.delete(state)
      return null
    })
  loaded.set(state, pending)
  return pending
}

/**
 * Picks the place list for each address: the state the address names, else the
 * company's map state. Load the states first, then look up synchronously.
 */
export async function placeIndexResolver(
  addresses: readonly (string | null)[],
  defaultState: MapStateCode,
): Promise<(address: string | null) => PlaceIndex> {
  const stateOf = (address: string | null): MapStateCode => {
    const named = address ? addressState(address) : null
    return named && isMapStateCode(named) ? named : defaultState
  }
  const states = [...new Set([defaultState, ...addresses.map(stateOf)])]
  const indexes = new Map(await Promise.all(states.map(async (state) => [state, await loadPlaceIndex(state)] as const)))
  const fallback = indexes.get(defaultState) ?? COLORADO_PLACES
  return (address) => indexes.get(stateOf(address)) ?? fallback
}
