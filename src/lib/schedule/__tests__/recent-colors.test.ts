import { describe, expect, it } from "vitest"

import {
  MAX_RECENT_SCHEDULE_COLORS,
  parseRecentScheduleColors,
  rememberRecentScheduleColor,
} from "../recent-colors"

describe("recent schedule colors", () => {
  it("puts the newest custom color first without duplicates", () => {
    expect(rememberRecentScheduleColor(["#112233", "#445566"], "#445566")).toEqual(["#445566", "#112233"])
    expect(rememberRecentScheduleColor([], "#ABCDEF")).toEqual(["#abcdef"])
  })

  it("ignores palette colors", () => {
    expect(rememberRecentScheduleColor(["#112233"], "blue")).toEqual(["#112233"])
  })

  it("keeps only the most recent few", () => {
    let recent: readonly string[] = []
    for (let index = 0; index < 10; index += 1) {
      recent = rememberRecentScheduleColor(recent, `#00000${index}`)
    }
    expect(recent).toHaveLength(MAX_RECENT_SCHEDULE_COLORS)
    expect(recent[0]).toBe("#000009")
  })

  it("reads stored lists safely", () => {
    expect(parseRecentScheduleColors(null)).toEqual([])
    expect(parseRecentScheduleColors("not json")).toEqual([])
    expect(parseRecentScheduleColors('{"a":1}')).toEqual([])
    expect(parseRecentScheduleColors('["#AABBCC","red","#aabbcc",5,"#123456"]')).toEqual(["#aabbcc", "#123456"])
  })
})
