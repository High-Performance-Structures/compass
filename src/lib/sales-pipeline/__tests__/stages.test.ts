import { describe, expect, it } from "vitest"
import { isBuiltInProjectJobStatusId } from "@/lib/project-profile"
import {
  isDeliveryMethod,
  SALES_STAGES,
  salesStageForJobStatus,
} from "@/lib/sales-pipeline/stages"

describe("sales pipeline stages", () => {
  it("uses only built-in job statuses, each in one stage", () => {
    const statuses = SALES_STAGES.flatMap((stage) => [...stage.statuses])
    expect(new Set(statuses).size).toBe(statuses.length)
    for (const status of statuses) expect(isBuiltInProjectJobStatusId(status)).toBe(true)
  })

  it("places tracker stages in order and leaves closed jobs out", () => {
    expect(salesStageForJobStatus("intake")).toBe("intake")
    expect(salesStageForJobStatus("price_sheet_sent")).toBe("pricing")
    expect(salesStageForJobStatus("budget_estimate_sent")).toBe("pricing")
    expect(salesStageForJobStatus("estimate_sent")).toBe("estimate_sent")
    expect(salesStageForJobStatus("awaiting_response")).toBe("following_up")
    expect(salesStageForJobStatus("follow_up")).toBe("following_up")
    expect(salesStageForJobStatus("ordered")).toBe("ordered")
    expect(salesStageForJobStatus("bracing_out")).toBe("bracing_out")
    for (const closed of ["complete", "closed", "inactive", "bid_refused"]) {
      expect(salesStageForJobStatus(closed)).toBeNull()
    }
  })

  it("accepts only the two delivery methods", () => {
    expect(isDeliveryMethod("delivery")).toBe(true)
    expect(isDeliveryMethod("pickup")).toBe(true)
    expect(isDeliveryMethod("ship")).toBe(false)
    expect(isDeliveryMethod(null)).toBe(false)
  })
})
