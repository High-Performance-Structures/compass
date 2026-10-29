// Build a state's portfolio-map terrain file: elevation grid, outline, major roads, labels.
//
//   node scripts/portfolio-map/build-state-terrain.mjs <data-dir> <ST> [<ST> ...]
//
// <data-dir> holds the public-domain Census inputs (downloaded once):
//   cb_2023_us_state_5m.{shp,dbf}          www2.census.gov/geo/tiger/GENZ2023/shp/
//   tl_2024_<fips>_prisecroads.{shp,dbf}   www2.census.gov/geo/tiger/TIGER2024/PRISECROADS/
// Elevation tiles (AWS Terrain Tiles, terrarium) are fetched into <data-dir>/tiles.
// Output: public/maps/states/<st>-terrain-v1.json
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import sharp from "sharp"
import { STATE_LABELS } from "./state-labels.mjs"

const [dataDir, ...codes] = process.argv.slice(2)
if (!dataDir || codes.length === 0) {
  console.error("usage: build-state-terrain.mjs <data-dir> <ST> [<ST> ...]")
  process.exit(1)
}
const OUT_DIR = path.join(process.cwd(), "public/maps/states")
// Same vertex budget as the Colorado grid (301 x 221).
const VERTEX_BUDGET = 301 * 221
const PAD_DEG = 0.04
// Islands smaller than this (square degrees, about 30 sq mi) are left off the outline.
const MIN_ISLAND = 0.008
// Compressed size budget per state file; roads are simplified harder (then state routes dropped) past it.
const GZIP_BUDGET = 250 * 1024
// Colorado's grid step in degrees; road simplification scales with each state's step.
const COLORADO_STEP = 7 / 300

/** Rings kept on a state's map beyond the island-size rule. */
const RING_FILTERS = {
  // Alaska: the Aleutians past the antimeridian and the far-western islands would stretch the
  // map across the Pacific; the mainland, Southeast, Kodiak and the eastern Aleutians stay.
  AK: (ring) => ring.every(([lon]) => lon < 0) && Math.max(...ring.map(([lon]) => lon)) > -169,
  // Hawaii: the eight main islands, not the Northwestern Hawaiian Islands.
  HI: (ring) => Math.max(...ring.map(([lon]) => lon)) > -160.6,
}

function readDbf(file) {
  const b = fs.readFileSync(file)
  const count = b.readUInt32LE(4)
  const headerLength = b.readUInt16LE(8)
  const recordLength = b.readUInt16LE(10)
  const fields = []
  for (let i = 32, offset = 1; b[i] !== 0x0d; i += 32) {
    const length = b[i + 16]
    fields.push({ name: b.toString("latin1", i, i + 11).replace(/\0.*$/, ""), offset, length })
    offset += length
  }
  const rows = []
  for (let r = 0; r < count; r += 1) {
    const start = headerLength + r * recordLength
    const row = {}
    for (const f of fields) row[f.name] = b.toString("latin1", start + f.offset, start + f.offset + f.length).trim()
    rows.push(row)
  }
  return rows
}

/** Polygon (5) and polyline (3) records as arrays of [lon, lat] parts. */
function readShp(file) {
  const b = fs.readFileSync(file)
  const records = []
  let i = 100
  while (i < b.length) {
    const length = b.readUInt32BE(i + 4) * 2
    const at = i + 8
    const type = b.readInt32LE(at)
    const parts = []
    if (type === 3 || type === 5) {
      const numParts = b.readInt32LE(at + 36)
      const numPoints = b.readInt32LE(at + 40)
      const starts = []
      for (let p = 0; p < numParts; p += 1) starts.push(b.readInt32LE(at + 44 + p * 4))
      const pointsAt = at + 44 + numParts * 4
      for (let p = 0; p < numParts; p += 1) {
        const end = p + 1 < numParts ? starts[p + 1] : numPoints
        const part = []
        for (let k = starts[p]; k < end; k += 1) {
          part.push([b.readDoubleLE(pointsAt + k * 16), b.readDoubleLE(pointsAt + k * 16 + 8)])
        }
        parts.push(part)
      }
    }
    records.push(parts)
    i = at + length
  }
  return records
}

function ringArea(ring) {
  let a = 0
  for (let k = 0, j = ring.length - 1; k < ring.length; j = k, k += 1) {
    a += (ring[j][0] - ring[k][0]) * (ring[j][1] + ring[k][1])
  }
  return a / 2
}

function rdp(points, eps) {
  if (points.length < 3) return points
  const [ax, ay] = points[0]
  const [bx, by] = points[points.length - 1]
  const L = Math.hypot(bx - ax, by - ay)
  let best = 0
  let index = 0
  for (let k = 1; k < points.length - 1; k += 1) {
    const [px, py] = points[k]
    const d = L === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (by - ay) * (ax - px)) / L
    if (d > best) {
      best = d
      index = k
    }
  }
  if (best <= eps) return [points[0], points[points.length - 1]]
  return [...rdp(points.slice(0, index + 1), eps).slice(0, -1), ...rdp(points.slice(index), eps)]
}

function pointInRing(lon, lat, ring) {
  let inside = false
  for (let k = 0, j = ring.length - 1; k < ring.length; j = k, k += 1) {
    const [xi, yi] = ring[k]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

async function tile(z, x, y) {
  const dir = path.join(dataDir, "tiles")
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${z}_${x}_${y}.png`)
  if (!fs.existsSync(file)) {
    const response = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`)
    if (!response.ok) throw new Error(`tile ${z}/${x}/${y}: ${response.status}`)
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()))
  }
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const meters = new Float64Array(256 * 256)
  for (let k = 0; k < 256 * 256; k += 1) {
    const o = k * info.channels
    meters[k] = data[o] * 256 + data[o + 1] + data[o + 2] / 256 - 32768
  }
  return meters
}

const states = readShp(path.join(dataDir, "cb_2023_us_state_5m.shp"))
const stateRows = readDbf(path.join(dataDir, "cb_2023_us_state_5m.dbf"))

for (const code of codes.map((c) => c.toUpperCase())) {
  const row = stateRows.findIndex((r) => r.STUSPS === code)
  if (row < 0) throw new Error(`unknown state ${code}`)
  const { NAME: name, STATEFP: fips } = stateRows[row]

  // Outer rings only (shapefile outers run clockwise: negative area here), small islands dropped.
  const keep = RING_FILTERS[code] ?? (() => true)
  const rings = states[row].filter((ring) => -ringArea(ring) > MIN_ISLAND && keep(ring))
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity
  for (const ring of rings) for (const [lon, lat] of ring) {
    west = Math.min(west, lon); east = Math.max(east, lon); south = Math.min(south, lat); north = Math.max(north, lat)
  }
  west = +(west - PAD_DEG).toFixed(3); east = +(east + PAD_DEG).toFixed(3)
  south = +(south - PAD_DEG).toFixed(3); north = +(north + PAD_DEG).toFixed(3)
  const midLat = (north + south) / 2
  const aspect = ((east - west) * Math.cos((midLat * Math.PI) / 180)) / (north - south)
  const GZ = Math.round(Math.sqrt(VERTEX_BUDGET / aspect))
  const GX = Math.round(GZ * aspect)

  // Zoom 7 (the Colorado source) or finer, so peaks survive the resampling.
  const step = (east - west) / (GX - 1)
  let Z = 7
  while (Z < 9 && 360 / (2 ** Z * 256) > step / 2) Z += 1
  const n = 2 ** Z
  const tx = (lon) => ((lon + 180) / 360) * n
  const ty = (lat) => {
    const r = (lat * Math.PI) / 180
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
  }
  const x0 = Math.floor(tx(west)), x1 = Math.floor(tx(east))
  const y0 = Math.floor(ty(north)), y1 = Math.floor(ty(south))
  const tiles = new Map()
  for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) tiles.set(`${x}_${y}`, await tile(Z, x, y))
  const at = (px, py) => {
    const x = Math.max(x0 * 256, Math.min((x1 + 1) * 256 - 1, px))
    const y = Math.max(y0 * 256, Math.min((y1 + 1) * 256 - 1, py))
    const t = tiles.get(`${Math.floor(x / 256)}_${Math.floor(y / 256)}`)
    return t[(y % 256) * 256 + (x % 256)]
  }
  // Median of the 3x3 tile pixels: the tiles carry single-pixel spikes and holes (a 3,000 m
  // spike in Lake Champlain, zeros along rivers) that would otherwise set the state's height range.
  const window = new Float64Array(9)
  const median = (px, py) => {
    let n = 0
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) window[n++] = at(px + dx, py + dy)
    return window.sort()[4]
  }
  const sample = (lon, lat) => {
    const px = tx(lon) * 256, py = ty(lat) * 256
    const fx0 = Math.floor(px), fy0 = Math.floor(py)
    const fx = px - fx0, fy = py - fy0
    const top = median(fx0, fy0) * (1 - fx) + median(fx0 + 1, fy0) * fx
    const bottom = median(fx0, fy0 + 1) * (1 - fx) + median(fx0 + 1, fy0 + 1) * fx
    return top * (1 - fy) + bottom * fy
  }

  const heights = new Uint16Array(GX * GZ)
  let hmin = Infinity, hmax = -Infinity
  for (let j = 0; j < GZ; j += 1) {
    const lat = north - ((north - south) * j) / (GZ - 1)
    for (let i = 0; i < GX; i += 1) {
      const lon = west + ((east - west) * i) / (GX - 1)
      // Sea floor and below-sea-level ground sit at 0.
      const h = Math.max(0, Math.min(65535, Math.round(sample(lon, lat))))
      heights[j * GX + i] = h
      if (rings.some((ring) => pointInRing(lon, lat, ring))) {
        hmin = Math.min(hmin, h); hmax = Math.max(hmax, h)
      }
    }
  }

  const outline = rings.map((ring) =>
    rdp(ring, 0.006).flatMap(([lon, lat]) => [+lon.toFixed(3), +lat.toFixed(3)]),
  )

  // Major roads: interstates and freeways, US routes, state routes.
  const roadFile = path.join(dataDir, `tl_2024_${fips}_prisecroads`)
  const roadParts = readShp(`${roadFile}.shp`)
  const roadRows = readDbf(`${roadFile}.dbf`)
  const buildRoads = (scale, stateRoutes) => {
    const eps = [0.004, 0.006, 0.008].map((e) => e * scale)
    const roads = []
    roadRows.forEach((r, k) => {
      const roadClass = r.MTFCC === "S1100" ? 0 : r.RTTYP === "U" || r.RTTYP === "I" ? 1 : r.RTTYP === "S" ? 2 : -1
      if (roadClass < 0 || (roadClass === 2 && !stateRoutes)) return
      // City loops, spurs and business routes crowd the statewide view.
      if (roadClass === 2 && /\b(Loop|Spur|Bus)\b/.test(r.FULLNAME)) return
      for (const part of roadParts[k]) {
        const points = part.filter(([lon, lat]) => lon >= west && lon <= east && lat >= south && lat <= north)
        if (points.length < 2) continue
        const s = rdp(points, eps[roadClass])
        if (roadClass === 2 && s.length <= 2 && Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) < 0.01 * scale) continue
        roads.push([roadClass, ...s.flatMap(([lon, lat]) => [+lon.toFixed(3), +lat.toFixed(3)])])
      }
    })
    return roads
  }

  const labels = STATE_LABELS[code] ?? []
  const base = Math.max(1, step / COLORADO_STEP)
  const attempts = [[base, true], [base * 2, true], [base * 2, false]]
  let json = ""
  let roadCount = 0
  let note = ""
  for (const [scale, stateRoutes] of attempts) {
    const roads = buildRoads(scale, stateRoutes)
    json = JSON.stringify({
      source: "Elevation: AWS Terrain Tiles (Mapzen; USGS 3DEP, SRTM). Outline and roads: U.S. Census Bureau TIGER/Line.",
      state: code,
      name,
      grid: {
        w: GX, h: GZ, west, east, north, south, min: Math.round(hmin), max: Math.round(hmax),
        u16: Buffer.from(heights.buffer).toString("base64"),
      },
      outline,
      labels,
      roads,
    })
    roadCount = roads.length
    note = scale === base && stateRoutes ? "" : stateRoutes ? "roads x2 simplified" : "no state routes"
    if (zlib.gzipSync(json, { level: 9 }).length <= GZIP_BUDGET) break
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const file = path.join(OUT_DIR, `${code.toLowerCase()}-terrain-v1.json`)
  fs.writeFileSync(file, json)
  console.log([code, `${GX}x${GZ}`, `z${Z}`, `${Math.round(hmin)}-${Math.round(hmax)}m`,
    `outline ${outline.length} rings/${outline.reduce((s, r) => s + r.length / 2, 0)} pts`, `roads ${roadCount}`,
    `${Math.round(json.length / 1024)}KB`, `gz ${Math.round(zlib.gzipSync(json, { level: 9 }).length / 1024)}KB`, note].join(" | "))
}
