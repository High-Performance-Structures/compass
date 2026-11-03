import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

import { describe, expect, it } from "vitest"

import {
  buildBuildertrendTemplateCaptureSql,
  parseBuildertrendTemplateCapture,
} from "@/lib/templates/buildertrend-template-capture"
import {
  buildBuildertrendTemplateInventorySql,
  parseBuildertrendTemplateInventory,
} from "@/lib/templates/buildertrend-template-inventory"

/*
 * The Buildertrend template SQL files are byte-identical to the ones built
 * before their statements moved into the templates store. The hashes were
 * taken from main's builders with the committed fixtures.
 */

const GOLDEN = {
  "org-1": {
    inventory: "310cacd72fa80e870cb5b03eb88c28316162be455d2d3dbfc0946bdcbd013e3f",
    capture: "e1209ffaf11eaf54c5cd45b8acd3769a0ef85a31376e23ccee28bf47fb462d10",
    published: "447f09d43bdef344cf45a301d5243ab19d76d69f9d5e907eaaa43f57a8f88cce",
  },
  "o'rg": {
    inventory: "044e6d4a41d887d18d5ca616c9d9e6cfb1e2a49a7e5632b5dec2327d91c805c7",
    capture: "ba03829d56352dbef67e85207b0a555d6202528dd8a5b696c0c7ef5723726ab0",
    published: "5e3ebf33c6cddd90970ea643cb0502df1d19875be21eb9a4f09f78d799091d91",
  },
} as const

async function fixture(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"))
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex")

describe("Buildertrend template SQL", () => {
  it("matches main's output for the committed inventory and capture", async () => {
    const inventory = parseBuildertrendTemplateInventory(
      await fixture("scripts/fixtures/buildertrend-active-template-inventory-2026-07-31.json")
    )
    const capture = parseBuildertrendTemplateCapture(
      await fixture("scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json")
    )
    if (!inventory.success || !capture.success) throw new Error("fixtures did not parse")

    for (const [organizationId, expected] of Object.entries(GOLDEN)) {
      expect(sha256(buildBuildertrendTemplateInventorySql(organizationId, inventory.data).sql)).toBe(
        expected.inventory
      )
      const build = (publishCapturedSchedules: boolean) =>
        buildBuildertrendTemplateCaptureSql({
          organizationId,
          inventory: inventory.data,
          capture: capture.data,
          publishCapturedSchedules,
        })
      expect(sha256(build(false).sql)).toBe(expected.capture)
      const published = build(true)
      expect(sha256(published.sql)).toBe(expected.published)
      expect([
        published.capturedTemplateCount,
        published.capturedScheduleCount,
        published.capturedScheduleItemCount,
      ]).toEqual([40, 30, 163])
    }
  })
})
