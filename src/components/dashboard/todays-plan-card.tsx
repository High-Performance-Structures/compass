import Link from "next/link"
import { IconAlertTriangle, IconCheck, IconChevronRight } from "@tabler/icons-react"

import type { PlanEntry, PlanSection, TodaysPlan, WeekLoad } from "@/lib/morning-plan/plan"
import type { TeamWorkloadRow } from "@/lib/morning-plan/server"

const SECTION_LABELS: Readonly<Record<PlanSection, string>> = {
  overdue: "Overdue",
  today: "Today",
  meetings: "Meetings",
  thisWeek: "Later this week",
}

const SECTIONS: readonly PlanSection[] = ["overdue", "today", "meetings", "thisWeek"]
/** Rows shown per section before "and N more". */
const SECTION_LIMIT = 5

function PlanRow({ entry }: { readonly entry: PlanEntry }) {
  return (
    <Link
      href={entry.href}
      className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{entry.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {entry.projectLabel ? `${entry.projectLabel} · ` : ""}
          {entry.detail}
        </span>
      </span>
      <IconChevronRight
        className="size-4 shrink-0 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        aria-hidden="true"
      />
    </Link>
  )
}

function OverloadNotice({ load }: { readonly load: WeekLoad }) {
  return (
    <div role="status" className="flex gap-3 border-t bg-destructive/5 px-4 py-3 text-sm">
      <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className="font-medium">
          This week holds {load.assignedWorkdays} workdays of assigned work for {load.availableWorkdays} available
          {load.percent !== null ? ` (${load.percent}%)` : ""}.
        </p>
        {load.suggestions.length > 0 ? (
          <div className="text-xs text-muted-foreground">
            <p>Could move:</p>
            <ul className="mt-1 space-y-0.5">
              {load.suggestions.map((item) => (
                <li key={item.key}>
                  <Link href={item.href} className="underline underline-offset-2 hover:text-foreground">
                    {item.projectLabel} · {item.title}
                  </Link>{" "}
                  ({item.reason})
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** The signed-in staff member's ordered plan for today, with this week's workload. */
export function TodaysPlanCard({
  plan,
  load,
  team,
}: {
  readonly plan: TodaysPlan
  readonly load: WeekLoad | null
  readonly team: readonly TeamWorkloadRow[]
}) {
  return (
    <section id="todays-plan" aria-labelledby="todays-plan-title" className="min-w-0 border-y border-border/70 bg-background">
      <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
        <h2 id="todays-plan-title" className="text-sm font-semibold">
          Today&apos;s plan
        </h2>
        <Link href="/dashboard/help/my-compass-calendar#todays-plan" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
          How this works
        </Link>
      </div>

      {plan.entries.length === 0 ? (
        <div className="border-t px-4 py-6 text-center">
          <IconCheck className="mx-auto size-5 text-primary" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium">Nothing assigned to you for today or the rest of this week</p>
        </div>
      ) : (
        SECTIONS.map((section) => {
          const entries = plan.entries.filter((entry) => entry.section === section)
          if (entries.length === 0) return null
          return (
            <div key={section} className="border-t">
              <p
                className={`px-4 pt-2.5 text-xs font-semibold uppercase tracking-wide ${
                  section === "overdue" ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {SECTION_LABELS[section]}
              </p>
              <div className="divide-y">
                {entries.slice(0, SECTION_LIMIT).map((entry) => (
                  <PlanRow key={entry.key} entry={entry} />
                ))}
              </div>
              {entries.length > SECTION_LIMIT ? (
                <p className="px-4 pb-2.5 text-xs text-muted-foreground">and {entries.length - SECTION_LIMIT} more</p>
              ) : null}
            </div>
          )
        })
      )}

      {load?.overloaded ? <OverloadNotice load={load} /> : null}

      {team.length > 0 ? (
        <div className="border-t">
          <p className="px-4 pt-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Team over capacity this week
          </p>
          <ul className="divide-y">
            {team.map((row) => (
              <li key={row.userId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate font-medium">{row.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {row.load.assignedWorkdays} of {row.load.availableWorkdays} workdays
                  {row.load.percent !== null ? ` · ${row.load.percent}%` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
