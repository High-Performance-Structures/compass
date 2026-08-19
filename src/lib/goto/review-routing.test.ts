import { describe, expect, it } from "vitest"

import {
  isInboundSmsTodoDestination,
  normalizeInboundSmsTodoDueDate,
} from "@/lib/goto/review-routing"

describe("inbound SMS task routing", () => {
  it("requires task details only for to-do destinations", () => {
    expect(isInboundSmsTodoDestination("todo")).toBe(true)
    expect(isInboundSmsTodoDestination("delivery")).toBe(true)
    expect(isInboundSmsTodoDestination("rfi")).toBe(false)
  })

  it("accepts real calendar dates and rejects malformed or impossible dates", () => {
    expect(normalizeInboundSmsTodoDueDate(" 2026-08-21 ")).toBe("2026-08-21")
    expect(normalizeInboundSmsTodoDueDate("2026-02-29")).toBeNull()
    expect(normalizeInboundSmsTodoDueDate("08/21/2026")).toBeNull()
    expect(normalizeInboundSmsTodoDueDate("")).toBeNull()
  })
})
