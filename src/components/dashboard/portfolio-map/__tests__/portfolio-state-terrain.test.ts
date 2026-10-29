import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { parseTerrainData, terrainFrame, terrainUrlForState } from "../portfolio-scene"
import { MAP_STATES } from "@/lib/portfolio-map/states"

const COLORADO = { west: -109.05, east: -102.05, north: 41, south: 37, min: 1023, max: 4134 }

describe("terrainFrame", () => {
  it("keeps Colorado's footprint and height scale", () => {
    const frame = terrainFrame(COLORADO)
    expect(frame.d).toBeCloseTo(10, 3)
    expect(frame.w).toBeCloseTo(13.6, 3)
    expect(frame.baseMeters).toBe(1000)
    expect(frame.unitsPerMeter).toBeCloseTo(1.7 / 3400, 8)
  })

  it("fits long states to the width and tall ones to the depth", () => {
    const tennessee = terrainFrame({ west: -90.35, east: -81.6, north: 36.72, south: 34.94, min: 56, max: 1857 })
    expect(tennessee.w).toBe(13.6)
    expect(tennessee.d).toBeLessThan(4)
    const california = terrainFrame({ west: -124.5, east: -114.1, north: 42.1, south: 32.5, min: 0, max: 3917 })
    expect(california.d).toBe(10)
    expect(california.w).toBeLessThan(10)
  })

  it("stretches flat states so their relief still shows", () => {
    const florida = terrainFrame({ west: -87.7, east: -80, north: 31, south: 24.5, min: 0, max: 100 })
    expect(florida.unitsPerMeter * 100).toBeCloseTo(0.4, 5)
  })
})

describe("state terrain files", () => {
  it("has a map file for every state", () => {
    for (const state of MAP_STATES) {
      const file = join(process.cwd(), "public", terrainUrlForState(state.code))
      expect(existsSync(file), state.code).toBe(true)
    }
  })

  it("parses a state file with its outline and labels", () => {
    const data = parseTerrainData(JSON.parse(readFileSync(join(process.cwd(), "public/maps/states/ut-terrain-v1.json"), "utf8")))
    expect(data.outline?.length).toBeGreaterThan(0)
    expect(data.labels?.[0]).toMatchObject({ title: "SALT LAKE CITY", sub: "STATE CAPITAL" })
    expect(data.grid.meters.length).toBe(data.grid.w * data.grid.h)
  })

  it("has a town and ZIP list for every state but Colorado", () => {
    for (const state of MAP_STATES.filter((entry) => entry.code !== "CO")) {
      expect(existsSync(join(process.cwd(), `public/maps/places/${state.code.toLowerCase()}-v1.json`)), state.code).toBe(true)
    }
  })
})
