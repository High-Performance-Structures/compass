import { describe, expect, it } from "vitest"
import { alertKind, parseAlerts, withZoneShapes, zonesNeedingShapes } from "@/lib/weather/alerts"
import { areaGrid, areaSamplePoints, DEFAULT_WEATHER_AREA, weatherPointKey } from "@/lib/weather/areas"
import { fireName, parseFires } from "@/lib/weather/fires"
import { milesToRing, pointInRing, simplifyRing } from "@/lib/weather/geometry"
import { DEFAULT_WEATHER_LIMITS, fireFlags, forecastFlags, windowTotals } from "@/lib/weather/layer"
import { alignSeries, durationHours, parseGridSeries, readCellSeries, SERIES_STEPS, type CellSeries } from "@/lib/weather/series"

const NOW = Date.parse("2026-10-25T13:30:00Z")

describe("forecast series", () => {
  it("reads NWS durations", () => {
    expect(durationHours("PT1H")).toBe(1)
    expect(durationHours("PT6H")).toBe(6)
    expect(durationHours("P1DT3H")).toBe(27)
    expect(durationHours("junk")).toBe(1)
  })

  it("turns gridpoint data into 3-hour steps in °F, inches and mph", () => {
    const series = parseGridSeries(
      {
        temperature: { values: [{ validTime: "2026-10-25T12:00:00+00:00/PT6H", value: -5 }] },
        quantitativePrecipitation: { values: [{ validTime: "2026-10-25T12:00:00+00:00/PT6H", value: 15.24 }] },
        snowfallAmount: { values: [{ validTime: "2026-10-25T12:00:00+00:00/PT6H", value: 152.4 }] },
        windGust: { values: [{ validTime: "2026-10-25T12:00:00+00:00/PT3H", value: 64.37 }, { validTime: "2026-10-25T15:00:00+00:00/PT3H", value: 32.19 }] },
        windDirection: { values: [{ validTime: "2026-10-25T12:00:00+00:00/PT6H", value: 274 }] },
      },
      NOW,
    )
    expect(series).not.toBeNull()
    if (!series) return
    expect(series.start).toBe("2026-10-25T12:00:00.000Z")
    expect(series.tempMinF.length).toBe(SERIES_STEPS)
    expect(series.tempMinF[0]).toBe(23)
    // 15.24 mm over 6 hours → 0.3 in per 3-hour step.
    expect(series.precipIn[0]).toBe(0.3)
    expect(series.snowIn[0]).toBe(3)
    expect(series.gustMph[0]).toBe(40)
    expect(series.gustMph[1]).toBe(20)
    expect(series.windDir[0]).toBe(270)
    expect(series.tempMinF[2]).toBeNull()
  })

  it("round-trips and re-aligns stored series", () => {
    const series = parseGridSeries({ temperature: { values: [{ validTime: "2026-10-25T12:00:00+00:00/P1D", value: 10 }] } }, NOW)
    if (!series) throw new Error("expected a series")
    const stored = readCellSeries(JSON.stringify(series))
    expect(stored?.tempMaxF[0]).toBe(50)
    const later = alignSeries(series, Date.parse("2026-10-25T18:00:00Z"), 4)
    expect(later.start).toBe("2026-10-25T18:00:00.000Z")
    expect(later.tempMaxF).toEqual([50, 50, 50, 50])
    expect(readCellSeries("not json")).toBeNull()
  })
})

const series = (overrides: Partial<CellSeries>): CellSeries => {
  const empty = Array.from({ length: 24 }, () => null)
  return { start: "2026-10-25T12:00:00.000Z", tempMinF: empty, tempMaxF: empty, precipIn: empty, snowIn: empty, gustMph: empty, windDir: empty, ...overrides }
}

describe("job flags", () => {
  it("adds up the next 24 hours against the company's limits", () => {
    const snowy = series({
      snowIn: [2, 2, 3, ...Array.from({ length: 21 }, () => 0)],
      precipIn: [0.2, 0.2, 0.3, ...Array.from({ length: 21 }, () => 0)],
      gustMph: [45, ...Array.from({ length: 23 }, () => 10)],
      tempMinF: [5, -8, ...Array.from({ length: 22 }, () => 10)],
    })
    expect(windowTotals(snowy, 0, 8).snowIn).toBe(7)
    const kinds = forecastFlags(snowy, 0, DEFAULT_WEATHER_LIMITS).map((flag) => flag.kind)
    expect(kinds).toEqual(["snow", "wind", "cold"])
    // Later in the time bar the storm has passed.
    expect(forecastFlags(snowy, 8, DEFAULT_WEATHER_LIMITS).map((flag) => flag.kind)).toEqual([])
    // A stricter company flags lighter wind.
    expect(forecastFlags(series({ gustMph: [25] }), 0, { ...DEFAULT_WEATHER_LIMITS, gustMph: 20 }).map((flag) => flag.kind)).toEqual(["wind"])
  })

  it("does not count snow's water as rain", () => {
    const flags = forecastFlags(series({ snowIn: [6], precipIn: [0.6] }), 0, DEFAULT_WEATHER_LIMITS)
    expect(flags.map((flag) => flag.kind)).toEqual(["snow"])
  })
})

const SQUARE = [-105.2, 38.8, -104.8, 38.8, -104.8, 39.2, -105.2, 39.2]

describe("geometry", () => {
  it("tests points and distances against outlines", () => {
    expect(pointInRing(-105, 39, SQUARE)).toBe(true)
    expect(pointInRing(-106, 39, SQUARE)).toBe(false)
    expect(milesToRing(-105, 39, SQUARE)).toBe(0)
    const miles = milesToRing(-105.5, 39, SQUARE)
    expect(miles).toBeGreaterThan(15)
    expect(miles).toBeLessThan(18)
  })

  it("simplifies outlines and rounds coordinates", () => {
    const wiggly = Array.from({ length: 50 }, (_, i): [number, number] => [-105 + i * 0.01, 39 + (i % 2) * 0.00001])
    const ring = simplifyRing(wiggly, 0.001)
    expect(ring.length).toBe(4)
    expect(ring[0]).toBe(-105)
  })
})

describe("NWS warnings", () => {
  it("keeps the warnings the map draws and sorts them by kind", () => {
    expect(alertKind("Winter Storm Warning")).toBe("winter")
    expect(alertKind("Red Flag Warning")).toBe("fire")
    expect(alertKind("Fire Weather Watch")).toBe("fire")
    expect(alertKind("High Wind Warning")).toBe("wind")
    expect(alertKind("Extreme Cold Warning")).toBe("cold")
    expect(alertKind("Flash Flood Warning")).toBe("flood")
    expect(alertKind("Special Weather Statement")).toBeNull()
  })

  it("parses outlines and falls back to zone outlines", () => {
    const alerts = parseAlerts({
      features: [
        {
          geometry: { type: "Polygon", coordinates: [[[-105, 39], [-104, 39], [-104, 40], [-105, 39]]] },
          properties: { id: "a1", event: "Winter Storm Warning", status: "Actual", headline: "Heavy snow", onset: "2026-10-25T12:00:00Z", ends: "2026-10-26T12:00:00Z", affectedZones: [] },
        },
        {
          geometry: null,
          properties: { id: "a2", event: "Red Flag Warning", status: "Actual", affectedZones: ["https://api.weather.gov/zones/fire/COZ214"] },
        },
        { geometry: null, properties: { id: "a3", event: "Air Quality Alert", status: "Actual", affectedZones: [] } },
        { geometry: null, properties: { id: "a4", event: "Winter Storm Warning", status: "Test", affectedZones: [] } },
      ],
    })
    expect(alerts.map((alert) => alert.id)).toEqual(["a1", "a2"])
    expect(alerts[0]?.level).toBe("warning")
    expect(alerts[0]?.rings[0]?.length).toBe(8)
    expect(zonesNeedingShapes(alerts)).toEqual(["fire/COZ214"])
    const filled = withZoneShapes(alerts, new Map([["fire/COZ214", [SQUARE]]]))
    expect(filled[1]?.rings).toEqual([SQUARE])
  })
})

describe("wildfires", () => {
  it("joins outlines to incident points and keeps outline-only fires", () => {
    const fires = parseFires(
      {
        features: [
          {
            geometry: { type: "Point", coordinates: [-105.1, 39.0] },
            properties: { IncidentName: "SPRING CREEK", IncidentSize: 1200, PercentContained: 20, IrwinID: "{abc-1}", FireDiscoveryDateTime: 1792000000000, ModifiedOnDateTime_dt: 1792100000000 },
          },
        ],
      },
      {
        features: [
          { geometry: { type: "Polygon", coordinates: [[[-105.2, 38.9], [-105.0, 38.9], [-105.0, 39.1], [-105.2, 38.9]]] }, properties: { poly_IRWINID: "{ABC-1}", poly_IncidentName: "Spring Creek" } },
          { geometry: { type: "Polygon", coordinates: [[[-106.2, 38.9], [-106.0, 38.9], [-106.0, 39.1], [-106.2, 38.9]]] }, properties: { poly_IRWINID: "{XYZ-2}", poly_IncidentName: "Lone Pine", attr_PercentContained: 40 } },
          { geometry: { type: "Polygon", coordinates: [[[-107.2, 38.9], [-107.0, 38.9], [-107.0, 39.1], [-107.2, 38.9]]] }, properties: { poly_IRWINID: "{OUT-3}", poly_IncidentName: "Done", attr_PercentContained: 100 } },
        ],
      },
    )
    expect(fires.map((fire) => fire.name)).toEqual(["Spring Creek", "Lone Pine"])
    expect(fires[0]?.rings.length).toBe(1)
    expect(fires[0]?.acres).toBe(1200)
    expect(fireName("O'BRIEN GULCH")).toBe("O'Brien Gulch")
  })

  it("flags jobs near a fire and under a Red Flag Warning", () => {
    const fire = { id: "f1", name: "Spring Creek", acres: 1200, containedPercent: 20, discoveredAt: null, updatedAt: null, lon: -105, lat: 39, rings: [SQUARE] }
    const redFlag = { id: "r1", event: "Red Flag Warning", kind: "fire" as const, level: "warning" as const, headline: "Red Flag Warning until 8 PM", onset: null, ends: null, rings: [SQUARE], zoneIds: [] }
    const near = fireFlags({ fires: [fire], alerts: [redFlag] }, -105.3, 39, DEFAULT_WEATHER_LIMITS, NOW)
    expect(near.map((flag) => flag.kind)).toEqual(["fire"])
    expect(near[0]?.detail).toMatch(/Spring Creek, \d+ mi east/)
    const inside = fireFlags({ fires: [fire], alerts: [redFlag] }, -105, 39, DEFAULT_WEATHER_LIMITS, NOW)
    expect(inside.map((flag) => flag.kind)).toEqual(["red_flag", "fire"])
    expect(fireFlags({ fires: [fire], alerts: [] }, -108, 39, DEFAULT_WEATHER_LIMITS, NOW)).toEqual([])
  })
})

describe("map areas", () => {
  it("samples about every 60 km with stable keys", () => {
    const grid = areaGrid(DEFAULT_WEATHER_AREA)
    const points = areaSamplePoints(DEFAULT_WEATHER_AREA)
    expect(points.length).toBe(grid.cols * grid.rows)
    expect(points.length).toBeGreaterThan(40)
    expect(points.length).toBeLessThan(80)
    expect(weatherPointKey(39.4812, -106.0423)).toBe("39.48,-106.04")
  })
})
