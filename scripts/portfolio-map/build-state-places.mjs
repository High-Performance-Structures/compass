// Build each state's town and ZIP lookup for placing jobs without an exact site point.
//
//   node scripts/portfolio-map/build-state-places.mjs <data-dir>
//
// <data-dir> holds the public-domain Census Gazetteer files (downloaded once):
//   2024_Gaz_place_national.txt   2024_Gaz_zcta_national.txt
//   www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/
// Output: public/maps/places/<st>-v1.json  { places: { key: [lon, lat, rank] }, zips: { zip: [lon, lat, town] } }
// Colorado keeps its own lists in src/lib/portfolio-map (built earlier from other sources).
import fs from "node:fs"
import path from "node:path"

const [dataDir] = process.argv.slice(2)
if (!dataDir) {
  console.error("usage: build-state-places.mjs <data-dir>")
  process.exit(1)
}
const OUT_DIR = path.join(process.cwd(), "public/maps/places")
const STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR",
  "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
])
// Incorporated places this large (square miles of land) rank as major cities.
const MAJOR_SQMI = 50

// Same normalization as the app's place keys.
const key = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
const round = (value) => Math.round(value * 10000) / 10000

function rows(file) {
  const lines = fs.readFileSync(path.join(dataDir, file), "utf8").split("\n").filter((line) => line.trim())
  const header = lines[0].split("\t").map((cell) => cell.trim())
  return lines.slice(1).map((line) => {
    const cells = line.split("\t").map((cell) => cell.trim())
    return Object.fromEntries(header.map((name, i) => [name, cells[i]]))
  })
}

// Places: "Aurora city", "Abanda CDP", "Nashville-Davidson metropolitan government (balance)".
const places = new Map() // state -> Map(key -> { lon, lat, rank, name, area })
for (const row of rows("2024_Gaz_place_national.txt")) {
  if (!STATES.has(row.USPS)) continue
  const name = row.NAME.replace(/\s+\([^)]*\)$/, "").replace(/(\s+(?:[a-z][a-z-]*|CDP))+$/, "").trim()
  const lon = Number(row.INTPTLONG)
  const lat = Number(row.INTPTLAT)
  const area = Number(row.ALAND_SQMI)
  if (!name || !Number.isFinite(lon) || !Number.isFinite(lat)) continue
  const incorporated = row.LSAD !== "57"
  const rank = incorporated ? (area >= MAJOR_SQMI ? 0 : 1) : 2
  const byKey = places.get(row.USPS) ?? new Map()
  places.set(row.USPS, byKey)
  // Consolidated cities: "Louisville/Jefferson County", "Nashville-Davidson" also answer to the first name.
  const names = [name, ...(/[/-]/.test(name) && rank === 0 ? [name.split(/[/-]/)[0]] : [])]
  for (const label of names) {
    const k = key(label)
    const current = byKey.get(k)
    // Same name twice in a state: the incorporated, then the larger, place wins.
    if (current && (current.rank < rank || (current.rank === rank && current.area >= area))) continue
    byKey.set(k, { lon, lat, rank, name: names[names.length - 1], area })
  }
}

// ZIP areas carry no state: the USPS three-digit prefix ranges give it.
const ZIP_PREFIXES = {
  AL: [[350, 369]], AK: [[995, 999]], AZ: [[850, 865]], AR: [[716, 729]], CA: [[900, 961]],
  CT: [[60, 69]], DE: [[197, 199]], FL: [[320, 349]], GA: [[300, 319], [398, 399]], HI: [[967, 968]],
  ID: [[832, 838]], IL: [[600, 629]], IN: [[460, 479]], IA: [[500, 528]], KS: [[660, 679]], KY: [[400, 427]],
  LA: [[700, 714]], ME: [[39, 49]], MD: [[206, 219]], MA: [[10, 27], [55, 55]], MI: [[480, 499]],
  MN: [[550, 567]], MS: [[386, 397]], MO: [[630, 658]], MT: [[590, 599]], NE: [[680, 693]], NV: [[889, 898]],
  NH: [[30, 38]], NJ: [[70, 89]], NM: [[870, 884]], NY: [[100, 149], [5, 5], [63, 63]], NC: [[270, 289]],
  ND: [[580, 588]], OH: [[430, 459]], OK: [[730, 749]], OR: [[970, 979]], PA: [[150, 196]], RI: [[28, 29]],
  SC: [[290, 299]], SD: [[570, 577]], TN: [[370, 385]], TX: [[750, 799], [733, 733], [885, 885]],
  UT: [[840, 847]], VT: [[50, 59]], VA: [[201, 201], [220, 246]], WA: [[980, 994]], WV: [[247, 268]],
  WI: [[530, 549]], WY: [[820, 831]],
}
function zipState(zip) {
  const prefix = Number(zip.slice(0, 3))
  // Narrow exceptions (055 Massachusetts inside Vermont's 050-059, 063 New York) are listed first.
  for (const [state, ranges] of Object.entries(ZIP_PREFIXES)) {
    if (ranges.some(([lo, hi]) => lo === hi && prefix === lo)) return state
  }
  for (const [state, ranges] of Object.entries(ZIP_PREFIXES)) {
    if (ranges.some(([lo, hi]) => prefix >= lo && prefix <= hi)) return state
  }
  return null
}

// Each ZIP is named for the nearest place in its state (places bucketed by whole degree).
const buckets = new Map()
for (const [state, byKey] of places) {
  for (const place of byKey.values()) {
    const b = `${Math.floor(place.lon)},${Math.floor(place.lat)}`
    const list = buckets.get(b) ?? []
    list.push({ state, ...place })
    buckets.set(b, list)
  }
}
const zips = new Map() // state -> { zip: [lon, lat, town] }
for (const row of rows("2024_Gaz_zcta_national.txt")) {
  const lon = Number(row.INTPTLONG)
  const lat = Number(row.INTPTLAT)
  const state = zipState(row.GEOID)
  if (!state || !STATES.has(state) || !Number.isFinite(lon) || !Number.isFinite(lat)) continue
  let best = null
  const kmPerLon = 111.32 * Math.cos((lat * Math.PI) / 180)
  for (let ring = 0; ring <= 4 && !best; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        for (const place of buckets.get(`${Math.floor(lon) + dx},${Math.floor(lat) + dy}`) ?? []) {
          if (place.state !== state) continue
          // Towns and cities name a ZIP before census-designated places.
          const km = Math.hypot((place.lat - lat) * 110.57, (place.lon - lon) * kmPerLon) + (place.rank === 2 ? 3 : 0)
          if (!best || km < best.km) best = { km, place }
        }
      }
    }
  }
  if (!best) continue
  const byZip = zips.get(state) ?? {}
  byZip[row.GEOID] = [round(lon), round(lat), best.place.name]
  zips.set(state, byZip)
}

fs.mkdirSync(OUT_DIR, { recursive: true })
for (const state of [...STATES].sort()) {
  const byKey = places.get(state) ?? new Map()
  const out = {
    source: "U.S. Census Bureau 2024 Gazetteer files (places and ZIP code tabulation areas).",
    places: Object.fromEntries([...byKey].sort(([a], [b]) => a.localeCompare(b)).map(([k, p]) => [k, [round(p.lon), round(p.lat), p.rank]])),
    zips: zips.get(state) ?? {},
  }
  const file = path.join(OUT_DIR, `${state.toLowerCase()}-v1.json`)
  fs.writeFileSync(file, JSON.stringify(out))
  console.log(state, `places ${byKey.size}`, `zips ${Object.keys(out.zips).length}`, `${Math.round(fs.statSync(file).size / 1024)} KB`)
}
