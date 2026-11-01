import { describe, expect, it } from "vitest"
import { airTimeLabel, aqiCategory, nearestAirReading, parseReportingAreas, parseSmokeKml, readAir, readSmoke, smokeAt } from "@/lib/weather/air"
import { DEFAULT_WEATHER_LIMITS, airFlags, fireFlags, smokeFlags } from "@/lib/weather/layer"
import { scheduleAirRisks } from "@/lib/weather/schedule-risk"

const COLORADO = { west: -109.05, east: -102.05, south: 37, north: 41 }

function placemark(density: string, coords: string): string {
  return `<Placemark><description><![CDATA[<div>Start Time: 2026305 1300UTC<br>End Time: 2026305 1600UTC<br>Density: ${density}<br>Satellite: GOES-WEST</div>]]></description>
<Polygon><outerBoundaryIs><LinearRing><coordinates>
${coords}
</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`
}

const SQUARE_AT = (lon: number, lat: number, half: number): string =>
  [[lon - half, lat - half], [lon + half, lat - half], [lon + half, lat + half], [lon - half, lat + half], [lon - half, lat - half]].map(([x, y]) => `${x},${y},0`).join("\n")

const KML = `<?xml version="1.0"?><kml><Document>
${placemark("Light", SQUARE_AT(-105, 39, 1))}
${placemark("Heavy", SQUARE_AT(-104.8, 38.8, 0.3))}
${placemark("Medium", SQUARE_AT(-120.4, 47.7, 0.2))}
</Document></kml>`

// IssueDate|ValidDate|ValidTime|TZ|HourOffset|DataType|Primary|ReportingArea|State|Lat|Lon|Parameter|AQI|Category|ActionDay|Discussion|Agency
const REPORTING = [
  "11/01/26|10/31/26||MST|-1|Y|Y|Colorado Springs|CO|38.8755|-104.6532|PM2.5|26|Good|No||CDPHE",
  "11/01/26|11/01/26|15:00|MST|0|O|Y|Colorado Springs|CO|38.8755|-104.6532|PM2.5|98|Moderate|No||CDPHE",
  "11/01/26|11/01/26|16:00|MST|0|O|Y|Colorado Springs|CO|38.8755|-104.6532|PM2.5|162|Unhealthy|No||CDPHE",
  "11/01/26|11/01/26|16:00|MST|0|O|N|Colorado Springs|CO|38.8755|-104.6532|OZONE|40|Good|No||CDPHE",
  "11/01/26|11/01/26||MST|0|F|Y|Colorado Springs|CO|38.8755|-104.6532|PM2.5|120|Unhealthy for Sensitive Groups|No||CDPHE",
  "11/01/26|11/02/26||MST|0|F|Y|Colorado Springs|CO|38.8755|-104.6532|PM2.5||Unhealthy|No||CDPHE",
  "11/01/26|11/01/26|16:00|MST|0|O|Y|Aspen|CO|39.1900|-106.8200|OZONE|19|Good|No||CDPHE",
  "11/01/26|11/01/26|16:00|PST|0|O|Y|Seattle|WA|47.6|-122.3|PM2.5|55|Moderate|No||PSCAA",
].join("\n")

describe("smoke", () => {
  it("keeps plumes over the area with density and satellite time", () => {
    const plumes = parseSmokeKml(KML, COLORADO)
    expect(plumes.map((plume) => plume.density)).toEqual(["light", "heavy"])
    expect(plumes[0]?.startsAt).toBe("2026-11-01T13:00:00.000Z")
    expect(readSmoke(JSON.stringify(plumes))).toEqual(plumes)
  })

  it("flags the densest smoke at or above the company's level", () => {
    const plumes = parseSmokeKml(KML, COLORADO)
    expect(smokeAt(plumes, -104.8, 38.8)?.density).toBe("heavy")
    expect(smokeFlags(plumes, -104.8, 38.8, DEFAULT_WEATHER_LIMITS)[0]?.label).toBe("HEAVY SMOKE")
    // Light smoke is under the default (medium) level…
    expect(smokeFlags(plumes, -105.6, 39.5, DEFAULT_WEATHER_LIMITS)).toEqual([])
    // …unless the company flags light smoke too.
    expect(smokeFlags(plumes, -105.6, 39.5, { smokeLevel: "light" })[0]?.label).toBe("LIGHT SMOKE")
  })
})

describe("air quality", () => {
  it("reads the latest worst reading and the worst forecast per day", () => {
    const readings = parseReportingAreas(REPORTING, COLORADO)
    expect(readings.map((reading) => reading.name)).toEqual(["Colorado Springs", "Aspen"])
    const springs = readings[0]
    expect(springs?.now).toEqual({ aqi: 162, category: "unhealthy", parameter: "PM2.5", date: "2026-11-01", time: "16:00 MST" })
    expect(springs?.forecasts).toEqual([
      { date: "2026-11-01", aqi: 120, category: "sensitive", parameter: "PM2.5" },
      { date: "2026-11-02", aqi: null, category: "unhealthy", parameter: "PM2.5" },
    ])
    expect(readAir(JSON.stringify(readings))).toEqual(readings)
    expect(aqiCategory(50)).toBe("good")
    expect(aqiCategory(151)).toBe("unhealthy")
    expect(airTimeLabel("16:00 MST")).toBe("4 PM MST")
    expect(airTimeLabel("09:30 PST")).toBe("9:30 AM PST")
  })

  it("flags a job from its nearest reporting area", () => {
    const readings = parseReportingAreas(REPORTING, COLORADO)
    expect(nearestAirReading(readings, -104.7, 38.9)?.reading.name).toBe("Colorado Springs")
    expect(nearestAirReading(readings, -103, 40)).toBeNull()
    const flags = airFlags(readings, -104.7, 38.9, DEFAULT_WEATHER_LIMITS)
    expect(flags[0]?.label).toBe("AQI 162")
    expect(flags[0]?.detail).toMatch(/^Air quality 162 \(Unhealthy, PM2\.5\) at Colorado Springs, 3 mi away, as of 4 PM MST\.$/)
    // A higher limit falls back to the forecast; above everything, no flag.
    expect(airFlags(readings, -104.7, 38.9, { aqi: 170 })).toEqual([])
    const forecastOnly = readings.map((reading) => ({ ...reading, now: null }))
    expect(airFlags(forecastOnly, -104.7, 38.9, { aqi: 151 })[0]?.label).toBe("UNHEALTHY AIR")
    // Fire & smoke flags include air quality.
    expect(fireFlags({ fires: [], alerts: [], smoke: [], air: readings }, -104.7, 38.9, DEFAULT_WEATHER_LIMITS, Date.now()).map((flag) => flag.kind)).toEqual(["air"])
  })

  it("puts scheduled work on poor-air days at risk", () => {
    const reading = parseReportingAreas(REPORTING, COLORADO)[0] ?? null
    const items = [
      { id: "a", title: "Frame walls", startDate: "2026-11-02", endDate: "2026-11-03" },
      { id: "b", title: "Pour slab", startDate: "2026-11-01", endDate: "2026-11-01" },
      { id: "c", title: "Trim", startDate: "2026-11-05", endDate: "2026-11-06" },
    ]
    const risks = scheduleAirRisks({ items, reading, aqiLimit: 151, today: "2026-11-01" })
    expect(risks.map((risk) => [risk.taskId, risk.date])).toEqual([["a", "2026-11-02"], ["b", "2026-11-01"]])
    expect(risks[1]?.detail).toMatch(/Air quality 162 \(Unhealthy\) at Colorado Springs/)
    expect(scheduleAirRisks({ items, reading: null, aqiLimit: 151, today: "2026-11-01" })).toEqual([])
  })
})
