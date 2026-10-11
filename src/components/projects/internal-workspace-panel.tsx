import type * as React from "react"
import Link from "next/link"
import { IconClipboardList } from "@tabler/icons-react"

import type { InternalWorkspaceSummary } from "@/app/actions/internal-duties"
import { statusText, TONE_CLASS } from "@/lib/internal-duties/recurring-display"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function weekLabel(weekStart: string): string {
  return new Date(`${weekStart}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/**
 * The Overview panel for an internal workspace (H-Office, the yard), in place
 * of a client job's workflow: this week's duty hours and what still needs a duty.
 */
export function InternalWorkspacePanel({ summary }: { readonly summary: InternalWorkspaceSummary }): React.ReactElement {
  const dutyLogHref = `/dashboard/projects/${summary.projectId}/duty-log`
  const maxHours = Math.max(1, ...summary.byDuty.map((row) => row.hours))
  return (
    <section aria-labelledby="internal-workspace-heading" className="grid gap-4 border-y py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{summary.workspaceKind === "office" ? "Office workspace" : "Field workspace"}</p>
          <h2 id="internal-workspace-heading" className="text-base font-semibold">
            This week since {weekLabel(summary.weekStart)}: {summary.weekHours.toFixed(2)} hours
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {summary.canEdit ? (
            <Button asChild size="sm">
              <Link href={dutyLogHref}>
                <IconClipboardList className="size-4" />
                Log duty
              </Link>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline">
            <Link href={dutyLogHref}>Open duty log</Link>
          </Button>
        </div>
      </div>

      {summary.attention.length > 0 ? (
        <div className="grid gap-1.5" aria-label="Recurring duties that need attention">
          <h3 className="text-sm font-semibold">Needs attention</h3>
          {summary.attention.map((duty) => {
            const status = statusText(duty)
            return (
              <div key={duty.id} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 text-sm">
                <span>{duty.accountName ? `${duty.title} · ${duty.accountName}` : duty.title}</span>
                <span className={cn("font-medium", TONE_CLASS[status.tone])}>{status.text}</span>
              </div>
            )
          })}
        </div>
      ) : null}

      {summary.byDuty.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing logged this week yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="grid gap-1.5" aria-label="Hours this week by duty">
            {summary.byDuty.map((row) => (
              <div key={row.code} className="grid grid-cols-[minmax(0,13rem)_1fr_3.5rem] items-center gap-3 text-sm">
                <span className="truncate">
                  {row.code} {row.label}
                </span>
                <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className="h-full bg-primary" style={{ width: `${Math.round((row.hours / maxHours) * 100)}%` }} />
                </div>
                <span className="text-right tabular-nums">{row.hours.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="grid content-start gap-1 text-sm" aria-label="Hours this week by person">
            {summary.byPerson.map((person) => (
              <div key={person.name} className="flex justify-between gap-3">
                <span>{person.name}</span>
                <span className="tabular-nums text-muted-foreground">{person.hours.toFixed(2)} h</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary.waitingLogs > 0 ? (
        <p className="text-sm">
          <Link href={`${dutyLogHref}#duty-waiting`} className="underline underline-offset-2">
            {summary.waitingLogs} daily {summary.waitingLogs === 1 ? "log is" : "logs are"} waiting for a duty
          </Link>
        </p>
      ) : null}
    </section>
  )
}
