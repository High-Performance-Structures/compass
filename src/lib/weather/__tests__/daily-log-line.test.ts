import { describe, expect, it } from "vitest"

import { forecastLogWeather } from "@/lib/weather/daily-log-line"
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
