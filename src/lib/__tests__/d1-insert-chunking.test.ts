import { drizzle } from "drizzle-orm/d1"
import { describe, expect, it } from "vitest"

import { weatherPoints } from "@/db/schema"
import { chunkD1InsertRows, chunkD1Rows } from "@/lib/d1-query"

function isD1Database(value: object): value is D1Database {
  return "prepare" in value
}

const fakeD1 = { prepare: () => ({}) }
if (!isD1Database(fakeD1)) throw new Error("fake D1 is incomplete")
const db = drizzle(fakeD1)

const weatherRows = Array.from({ length: 30 }, (_, index) => ({
  pointKey: `point-${index}`,
  latitude: 39,
  longitude: -105,
  requestedAt: "2026-10-31T12:00:00.000Z",
}))

describe("multi-row insert chunking", () => {
  it("keeps every weather point insert within D1's 100 bound parameters", () => {
    // Drizzle also binds the status default for each row, so counting the
    // four passed keys (chunkD1Rows) produced 125-parameter statements.
    const unsafe = db.insert(weatherPoints).values(chunkD1Rows(weatherRows)[0] ?? []).toSQL()
    expect(unsafe.params.length).toBeGreaterThan(100)

    for (const chunk of chunkD1InsertRows(weatherPoints, weatherRows)) {
      const query = db.insert(weatherPoints).values(chunk).onConflictDoNothing().toSQL()
      expect(query.params.length).toBeLessThanOrEqual(100)
    }
    expect(chunkD1InsertRows(weatherPoints, weatherRows).flat()).toHaveLength(30)
  })

  it("sizes chunks by the table's columns and reserves fixed parameters", () => {
    // weather_points has 7 columns: 100 / 7 = 14 rows; (100 - 10) / 7 = 12 rows.
    expect(chunkD1InsertRows(weatherPoints, weatherRows).map((chunk) => chunk.length)).toEqual([14, 14, 2])
    expect(chunkD1InsertRows(weatherPoints, weatherRows, 10).map((chunk) => chunk.length)).toEqual([12, 12, 6])
  })
})
