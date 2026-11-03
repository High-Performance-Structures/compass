import { describe, expect, it } from "vitest"

import { inboxStatePatch, JS_TRIM_CHARACTERS } from "@/lib/domain/correspondence/rules"

describe("correspondence rules", () => {
  it("maps each inbox action to the one flag it changes", () => {
    expect(inboxStatePatch("save")).toEqual({ saved: true })
    expect(inboxStatePatch("unsave")).toEqual({ saved: false })
    expect(inboxStatePatch("follow-up")).toEqual({ followUp: true })
    expect(inboxStatePatch("clear-follow-up")).toEqual({ followUp: false })
    expect(inboxStatePatch("archive")).toEqual({ archived: true })
    expect(inboxStatePatch("restore")).toEqual({ archived: false })
  })

  it("trims the same characters as JavaScript's String.prototype.trim", () => {
    const padding = JS_TRIM_CHARACTERS
    expect(`${padding}hello${padding}`.trim()).toBe("hello")
    for (const character of padding) expect(character.trim()).toBe("")
  })
})
