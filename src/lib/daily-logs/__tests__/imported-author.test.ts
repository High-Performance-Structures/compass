import { describe, expect, it } from "vitest"

import {
  dailyLogAuthorName,
  importedDailyLogAuthor,
} from "@/lib/daily-logs/imported-author"

describe("imported daily-log authors", () => {
  it("reads the retained Buildertrend author", () => {
    expect(
      importedDailyLogAuthor(
        JSON.stringify({ buildertrendAuthor: " Stanley Platt " })
      )
    ).toBe("Stanley Platt")
  })

  it("rejects invalid or unrelated tags", () => {
    expect(importedDailyLogAuthor(null)).toBeNull()
    expect(importedDailyLogAuthor("not-json")).toBeNull()
    expect(importedDailyLogAuthor(JSON.stringify(["buildertrend"]))).toBeNull()
    expect(importedDailyLogAuthor(JSON.stringify({ tags: ["buildertrend"] }))).toBeNull()
  })

  it("prefers a linked Compass user over imported attribution", () => {
    expect(
      dailyLogAuthorName({
        compassAuthorName: "Current User",
        tags: JSON.stringify({ buildertrendAuthor: "Imported User" }),
      })
    ).toBe("Current User")
  })
})
