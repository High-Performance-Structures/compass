import { describe, expect, it } from "vitest"

import { statusLabel } from "@/lib/project-operations/status"

describe("project operation statuses", () => {
  it("normalizes imported labels for display", () => {
    expect(statusLabel("Partially Received")).toBe("Partially Received")
    expect(statusLabel("response_received")).toBe("Response Received")
  })
})
