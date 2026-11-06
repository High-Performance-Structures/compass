import { describe, expect, it } from "vitest"

import {
  canonicalRfiStatus,
  compareRfisForQueue,
  isClosedRfiStatus,
  validRfiAudience,
  validRfiPriority,
} from "@/lib/rfis/status"

describe("RFI status handling", () => {
  it("normalizes legacy production statuses", () => {
    expect(canonicalRfiStatus("open")).toBe("new")
    expect(canonicalRfiStatus("answered")).toBe("in_progress")
    expect(canonicalRfiStatus("closed")).toBe("complete")
    expect(canonicalRfiStatus("cancelled")).toBe("void")
  })

  it("reads legacy closed statuses as closed", () => {
    expect(isClosedRfiStatus("closed")).toBe(true)
    expect(isClosedRfiStatus("answered")).toBe(false)
  })

  it("sorts active RFIs before completed RFIs", () => {
    const items = [
      {
        status: "complete",
        dueDate: "2026-07-20",
        submittedAt: "2026-07-20T12:00:00.000Z",
        rfiNumber: "RFI-001",
      },
      {
        status: "new",
        dueDate: "2026-07-27",
        submittedAt: "2026-07-26T12:00:00.000Z",
        rfiNumber: "RFI-003",
      },
      {
        status: "in_progress",
        dueDate: "2026-07-26",
        submittedAt: "2026-07-25T12:00:00.000Z",
        rfiNumber: "RFI-002",
      },
    ]

    expect(items.sort(compareRfisForQueue).map((item) => item.rfiNumber)).toEqual(
      ["RFI-002", "RFI-003", "RFI-001"]
    )
  })

  it("rejects unsupported mutation values", () => {
    expect(validRfiPriority("high")).toBe("high")
    expect(validRfiPriority("urgent")).toBeNull()
    expect(validRfiAudience("owner")).toBe("owner")
    expect(validRfiAudience("everyone")).toBeNull()
  })
})
