import { DEFAULT_NEW_SCHEDULE_ITEM_WORKDAYS } from "@/components/schedule/schedule-item-defaults"
import { describe, expect, it } from "vitest"

describe("new schedule item form", () => {
  it("starts a new item with a one-workday duration", () => {
    expect(DEFAULT_NEW_SCHEDULE_ITEM_WORKDAYS).toBe(1)
  })
})
