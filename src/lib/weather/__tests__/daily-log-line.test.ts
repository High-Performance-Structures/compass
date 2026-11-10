import { afterEach, describe, expect, it, vi } from "vitest"

import { forecastLogWeather, recordedLogWeather } from "@/lib/weather/daily-log-line"
import { fetchRecordedWeatherDay } from "@/lib/weather/daily-log-server"
import type { SiteWeatherDay } from "@/lib/weather/schedule-risk-server"

const day = (patch: Partial<SiteWeatherDay>): SiteWeatherDay => ({
  date: "2026-11-02",
  highF: 24,
  lowF: 6,
  snowIn: 0,
  rainIn: 0,
  gustMph: null,
  ...patch,
})

describe("forecastLogWeather", () => {
  it("writes the mockup's snow day", () => {
    expect(forecastLogWeather(day({ snowIn: 6.2, gustMph: 40 }), [])).toEqual({
      tempF: 24,
      conditions: "Snow, low 6F, gusts 40 mph",
      precipitation: "6.2 in snow forecast",
    })
  })

  it("calls a calm day with no rain dry and leaves light gusts out", () => {
    expect(forecastLogWeather(day({ highF: 71, lowF: 44, gustMph: 12 }), [])).toEqual({
      tempF: 71,
      conditions: "Dry, low 44F",
      precipitation: "None forecast",
    })
  })

  it("names rain and snow together", () => {
    const weather = forecastLogWeather(day({ snowIn: 0.4, rainIn: 0.12 }), [])
    expect(weather.conditions).toBe("Rain and snow, low 6F")
    expect(weather.precipitation).toBe("0.4 in snow, 0.12 in rain forecast")
  })

  it("adds warnings, smoke and poor air but not fire distances or forecast flags", () => {
    const weather = forecastLogWeather(day({}), [
      { kind: "warning", label: "WINTER STORM WARNING", detail: "" },
      { kind: "smoke", label: "HEAVY SMOKE", detail: "" },
      { kind: "air", label: "AQI 162", detail: "" },
      { kind: "fire", label: "CAMERON PEAK · 4 MI", detail: "" },
      { kind: "snow", label: "SNOW 6 IN", detail: "" },
    ])
    expect(weather.conditions).toBe("Dry, low 6F, Winter Storm Warning, Heavy Smoke, AQI 162")
  })

  it("keeps a missing temperature empty", () => {
    expect(forecastLogWeather(day({ highF: null, lowF: null }), []).tempF).toBeNull()
    expect(forecastLogWeather(day({ highF: null, lowF: null }), []).conditions).toBe("Dry")
  })
})

describe("recordedLogWeather", () => {
  it("writes a past day in the forecast line's shape, as recorded", () => {
    expect(recordedLogWeather({ sky: "Drizzle", highF: 54, lowF: 33, rainIn: 0.13, snowIn: 0, gustMph: 25 })).toEqual({
      tempF: 54,
      conditions: "Drizzle, low 33F, gusts 25 mph",
      precipitation: "0.13 in rain recorded",
    })
    expect(recordedLogWeather({ sky: "Clear", highF: 68, lowF: 39, rainIn: 0, snowIn: 0, gustMph: 9 })).toEqual({
      tempF: 68,
      conditions: "Clear, low 39F",
      precipitation: "None recorded",
    })
  })
})

describe("fetchRecordedWeatherDay", () => {
  afterEach(() => vi.unstubAllGlobals())

  const respond = (daily: unknown) => {
    const fetchMock = vi.fn<(input: URL | string) => Promise<Response>>(async () => new Response(JSON.stringify({ daily })))
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  it("reads the day's high, low, rain, snow and gusts in the company's time zone", async () => {
    const fetchMock = respond({
      weather_code: [53],
      temperature_2m_max: [54.1],
      temperature_2m_min: [32.6],
      rain_sum: [0.126],
      snowfall_sum: [0.04],
      wind_gusts_10m_max: [24.8],
    })
    const day = await fetchRecordedWeatherDay({ lat: 38.83, lon: -104.8 }, "2026-11-04", "America/Chicago")
    expect(day).toEqual({ sky: "Drizzle", highF: 54, lowF: 33, rainIn: 0.13, snowIn: 0, gustMph: 25 })
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(url.searchParams.get("timezone")).toBe("America/Chicago")
    expect(url.searchParams.get("start_date")).toBe("2026-11-04")
  })

  it("treats a day the archive hasn't filled in as missing", async () => {
    respond({ weather_code: [null], temperature_2m_max: [null], temperature_2m_min: [null] })
    expect(await fetchRecordedWeatherDay({ lat: 38.83, lon: -104.8 }, "2026-11-09", "America/Denver")).toBeNull()
  })
})
