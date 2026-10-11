import { describe, expect, it } from "vitest"
import { dutiesNeedingAttention, type RecurringDutyView } from "@/lib/internal-duties/recurring-data"
import { statusText } from "@/lib/internal-duties/recurring-display"

function duty(id: string, status: RecurringDutyView["status"], active = true): RecurringDutyView {
  return { id, title: "Bank reconciliation", accountName: id, cadence: "monthly", dueDay: 15, dutyCode: "502", ownerUserId: null, ownerName: null, active, lastDone: null, status }
}

describe("recurring duties needing attention", () => {
  it("lists the furthest behind first and leaves out current and turned-off duties", () => {
    const list = dutiesNeedingAttention([
      duty("current", { kind: "current", nextPeriod: "2026-10", nextDue: "2026-11-15" }),
      duty("soon", { kind: "due_soon", nextPeriod: "2026-09", nextDue: "2026-10-15" }),
      duty("one", { kind: "behind", owed: ["2026-08"], oldestDue: "2026-09-15" }),
      duty("four", { kind: "behind", owed: ["2026-05", "2026-06", "2026-07", "2026-08"], oldestDue: "2026-06-15" }),
      duty("new", { kind: "not_started" }),
      duty("off", { kind: "behind", owed: ["2026-01"], oldestDue: "2026-02-15" }, false),
    ])
    expect(list.map((item) => item.id)).toEqual(["four", "one", "soon", "new"])
  })

  it("describes a duty that is behind", () => {
    expect(statusText(duty("FSB", { kind: "behind", owed: ["2026-05", "2026-06", "2026-07", "2026-08"], oldestDue: "2026-06-15" }))).toEqual({
      text: "4 months behind · May 2026 was due Jun 15",
      tone: "late",
    })
  })
})
