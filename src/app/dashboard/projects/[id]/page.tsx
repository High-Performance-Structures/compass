import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import { projects, scheduleTasks } from "@/db/schema"
import { eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import Link from "next/link"
import { MobileProjectSwitcher } from "@/components/mobile-project-switcher"
import {
  IconAlertTriangle,
  IconCalendarStats,
  IconCheck,
  IconClock,
  IconDots,
  IconFlag,
  IconThumbUp,
} from "@tabler/icons-react"
import type { ScheduleTask } from "@/db/schema"

function getWeekDays(): { date: Date; dayName: string }[] {
  const today = new Date()
  const day = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1))

  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    days.push({
      date: d,
      dayName: d.toLocaleDateString("en-US", { weekday: "long" }),
    })
  }
  return days
}

function formatDateStr(d: Date): string {
  return d.toISOString().split("T")[0]
}

function isTaskOnDate(task: ScheduleTask, dateStr: string): boolean {
  return task.startDate <= dateStr && task.endDateCalculated >= dateStr
}

export default async function ProjectSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let project: {
    id: string
    name: string
    status: string
    address: string | null
    clientName: string | null
    projectManager: string | null
    createdAt: string
  } | null = null
  let tasks: ScheduleTask[] = []

  try {
    const { env } = await getCloudflareContext()
    if (!env?.DB) throw new Error("D1 not available")

    const db = getDb(env.DB)

    const [found] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1)

    if (!found) notFound()
    project = found

    tasks = await db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.projectId, id))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    if (e?.digest === "NEXT_NOT_FOUND") throw e
    console.warn("D1 unavailable in dev mode, using empty data")
  }

  const projectName = project?.name ?? "Project"
  const projectStatus = project?.status ?? "OPEN"
  const todayStr = formatDateStr(new Date())

  const completedTasks = tasks.filter((t) => t.status === "COMPLETE")
  const activeTasks = tasks.filter((t) => t.status !== "COMPLETE")
  const totalCount = tasks.length
  const completedPercent = totalCount > 0
    ? Math.round((completedTasks.length / totalCount) * 100)
    : 0

  const pastDue = activeTasks.filter(
    (t) => t.endDateCalculated < todayStr
  )
  const dueToday = activeTasks.filter(
    (t) => t.endDateCalculated === todayStr
  )
  const upcomingMilestones = tasks.filter(
    (t) => t.isMilestone && t.startDate >= todayStr && t.status !== "COMPLETE"
  )

  // phase breakdown
  const phases = new Map<string, { total: number; completed: number }>()
  for (const t of tasks) {
    const entry = phases.get(t.phase) ?? { total: 0, completed: 0 }
    entry.total++
    if (t.status === "COMPLETE") entry.completed++
    phases.set(t.phase, entry)
  }

  // recent updates (tasks sorted by updatedAt desc)
  const recentUpdates = [...tasks]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5)

  // week agenda
  const weekDays = getWeekDays()
  const weekAgenda = weekDays.map((day) => {
    const dateStr = formatDateStr(day.date)
    const dayTasks = tasks.filter((t) => isTaskOnDate(t, dateStr))
    const isToday = dateStr === todayStr
    const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6
    return { ...day, dateStr, dayTasks, isToday, isWeekend }
  })

  return (
    <div className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {/* header */}
        <div className="flex items-start justify-between mb-1">
          <MobileProjectSwitcher
            projectName={projectName}
            projectId={id}
            status={projectStatus}
          />
          <button className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground shrink-0 mt-0.5">
            <IconDots className="size-5" />
          </button>
        </div>

        {/* meta line: address + tasks */}
        <div className="text-sm text-muted-foreground space-y-0.5 mb-3">
          {project?.address && <p>{project.address}</p>}
          <p>
            {totalCount} tasks &middot; {completedPercent}% complete
            {project?.clientName && (
              <> &middot; {project.clientName}</>
            )}
            {project?.projectManager && (
              <> &middot; {project.projectManager}</>
            )}
          </p>
        </div>

        {/* schedule link */}
        <div className="mb-5 sm:mb-6">
          <Link
            href={`/dashboard/projects/${id}/schedule`}
            className="text-sm text-primary hover:underline inline-flex items-center gap-1.5"
          >
            <IconCalendarStats className="size-4" />
            View schedule
          </Link>
        </div>

        {/* progress bar */}
        <div className="rounded-lg border p-3 sm:p-4 mb-4 sm:mb-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Overall Progress</p>
            <p className="text-sm font-semibold">{completedPercent}%</p>
          </div>
          <div className="w-full h-2 rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${completedPercent}%` }}
            />
          </div>
          <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
            <span>{completedTasks.length} completed</span>
            <span>{activeTasks.length} in progress</span>
            {pastDue.length > 0 && (
              <span className="text-destructive">{pastDue.length} overdue</span>
            )}
          </div>
        </div>

        {/* urgency columns */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px rounded-lg border overflow-hidden mb-4 sm:mb-6">
          <div className="p-3 sm:p-4 bg-background">
            <p className="text-xs font-medium uppercase text-muted-foreground mb-3">
              Past Due
            </p>
            {pastDue.length > 0 ? (
              <div className="space-y-2">
                {pastDue.slice(0, 4).map((t) => (
                  <div key={t.id} className="flex items-center justify-between">
                    <span className="text-sm truncate mr-2">{t.title}</span>
                    <span className="text-xs text-destructive font-medium shrink-0">
                      {new Date(t.endDateCalculated).toLocaleDateString(
                        "en-US", { month: "short", day: "numeric" }
                      )}
                    </span>
                  </div>
                ))}
                {pastDue.length > 4 && (
                  <p className="text-xs text-muted-foreground">
                    +{pastDue.length - 4} more
                  </p>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <IconThumbUp className="size-4" />
                Nothing past due
              </div>
            )}
          </div>

          <div className="p-3 sm:p-4 bg-background border-t sm:border-t-0 sm:border-x">
            <p className="text-xs font-medium uppercase text-muted-foreground mb-3">
              Due Today
            </p>
            {dueToday.length > 0 ? (
              <div className="space-y-2">
                {dueToday.map((t) => (
                  <div key={t.id} className="text-sm truncate">{t.title}</div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <IconThumbUp className="size-4" />
                Nothing due today
              </div>
            )}
          </div>

          <div className="p-3 sm:p-4 bg-background border-t sm:border-t-0">
            <p className="text-xs font-medium uppercase text-muted-foreground mb-3">
              Upcoming Milestones
            </p>
            {upcomingMilestones.length > 0 ? (
              <div className="space-y-2">
                {upcomingMilestones.slice(0, 4).map((t) => (
                  <div key={t.id} className="flex items-center justify-between">
                    <span className="text-sm truncate mr-2">{t.title}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(t.startDate).toLocaleDateString(
                        "en-US", { month: "short", day: "numeric" }
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <IconFlag className="size-4" />
                No upcoming milestones
              </div>
            )}
          </div>
        </div>

        {/* two-column: phases + active tasks */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
          {/* phase breakdown */}
          <div>
            <h2 className="text-xs font-medium uppercase text-muted-foreground mb-3">
              Phases
            </h2>
            {phases.size > 0 ? (
              <div className="space-y-3">
                {[...phases.entries()].map(([phase, data]) => {
                  const pct = Math.round((data.completed / data.total) * 100)
                  return (
                    <div key={phase}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm capitalize">{phase}</span>
                        <span className="text-xs text-muted-foreground">
                          {data.completed}/{data.total}
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No phases yet.</p>
            )}
          </div>

          {/* active tasks */}
          <div>
            <h2 className="text-xs font-medium uppercase text-muted-foreground mb-3">
              Active Tasks
            </h2>
            {activeTasks.length > 0 ? (
              <div className="space-y-2.5">
                {activeTasks
                  .sort((a, b) => a.startDate.localeCompare(b.startDate))
                  .slice(0, 8)
                  .map((t) => (
                    <div key={t.id} className="flex items-center gap-2 text-sm">
                      {t.endDateCalculated < todayStr ? (
                        <IconAlertTriangle className="size-3.5 text-destructive shrink-0" />
                      ) : (
                        <IconClock className="size-3.5 text-muted-foreground shrink-0" />
                      )}
                      <span className="truncate flex-1">{t.title}</span>
                      <div className="w-12 h-1.5 rounded-full bg-muted shrink-0">
                        <div
                          className="h-full rounded-full bg-foreground/50"
                          style={{ width: `${t.percentComplete}%` }}
                        />
                      </div>
                    </div>
                  ))}
                {activeTasks.length > 8 && (
                  <Link
                    href={`/dashboard/projects/${id}/schedule`}
                    className="text-xs text-primary hover:underline"
                  >
                    +{activeTasks.length - 8} more in schedule
                  </Link>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <IconCheck className="size-4" />
                All tasks complete
              </div>
            )}
          </div>
        </div>

        {/* recent updates */}
        <div>
          <h2 className="text-xs font-medium uppercase text-muted-foreground mb-3">
            Recent Updates
          </h2>
          {recentUpdates.length > 0 ? (
            <div className="space-y-3">
              {recentUpdates.map((t) => (
                <div key={t.id} className="flex items-start gap-3">
                  <div className="size-7 rounded-full bg-muted flex items-center justify-center mt-0.5 shrink-0">
                    {t.status === "COMPLETE" ? (
                      <IconCheck className="size-3.5 text-primary" />
                    ) : (
                      <IconClock className="size-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{t.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.status === "COMPLETE" ? "Completed" : `${t.percentComplete}% complete`}
                      {" \u00b7 "}
                      {t.phase}
                      {" \u00b7 "}
                      {new Date(t.updatedAt).toLocaleDateString(
                        "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No recent activity.</p>
          )}
        </div>
      </div>

      {/* right sidebar: week agenda */}
      <div className="w-full lg:w-72 border-t lg:border-t-0 lg:border-l overflow-y-auto p-3 sm:p-4 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-medium uppercase text-muted-foreground">
            This Week
          </h2>
          <Link
            href={`/dashboard/projects/${id}/schedule`}
            className="text-xs text-primary hover:underline"
          >
            View schedule
          </Link>
        </div>
        <div className="space-y-1">
          {weekAgenda.map((day) => (
            <div
              key={day.dateStr}
              className={`flex gap-3 rounded-md p-2 ${
                day.isToday ? "bg-accent" : ""
              }`}
            >
              <div className="text-center shrink-0 w-10">
                <p className={`text-lg font-semibold leading-none ${
                  day.isToday ? "text-primary" : ""
                }`}>
                  {day.date.getDate()}
                </p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{day.dayName}</p>
                {day.isWeekend ? (
                  <p className="text-xs text-muted-foreground">Non-workday</p>
                ) : day.dayTasks.length > 0 ? (
                  <div className="space-y-0.5">
                    {day.dayTasks.slice(0, 3).map((t) => (
                      <p key={t.id} className="text-xs text-muted-foreground truncate">
                        {t.title}
                      </p>
                    ))}
                    {day.dayTasks.length > 3 && (
                      <p className="text-xs text-muted-foreground">
                        +{day.dayTasks.length - 3} more
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No tasks</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
