import { behindLabel, periodLabel } from "@/lib/internal-duties/recurring"
import type { RecurringDutyView } from "@/lib/internal-duties/recurring-data"

function shortDate(value: string): string {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/** One line describing where a recurring duty stands, with its tone. */
export function statusText(duty: RecurringDutyView): { readonly text: string; readonly tone: "ok" | "due" | "late" | "muted" } {
  const status = duty.status
  if (status.kind === "behind") {
    return { text: `${behindLabel(status.owed.length, duty.cadence)} · ${periodLabel(status.owed[0] ?? "")} was due ${shortDate(status.oldestDue)}`, tone: "late" }
  }
  if (status.kind === "due_soon") return { text: `${periodLabel(status.nextPeriod)} due ${shortDate(status.nextDue)}`, tone: "due" }
  if (status.kind === "not_started") return { text: "Mark the last period done to start tracking", tone: "muted" }
  return { text: `Current · ${periodLabel(status.nextPeriod)} due ${shortDate(status.nextDue)}`, tone: "ok" }
}

export const TONE_CLASS = { ok: "text-success", due: "text-warning", late: "text-destructive", muted: "text-muted-foreground" } as const

