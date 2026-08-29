import Link from "next/link"
import { redirect } from "next/navigation"
import { IconActivity, IconChevronRight } from "@tabler/icons-react"

import { getActivityEvents } from "@/app/actions/activity"
import { getProjects } from "@/app/actions/projects"
import { Badge } from "@/components/ui/badge"
import { SearchableComboboxField } from "@/components/searchable-combobox"
import { getCurrentUser } from "@/lib/auth"
import {
  ACTIVITY_CATEGORIES,
  type ActivityCategory,
} from "@/lib/activity-log"
import { isInternalStaffRole } from "@/lib/user-roles"

const CATEGORY_LABELS: Readonly<Record<ActivityCategory, string>> = {
  access: "Access",
  account: "Accounts",
  conversation: "Conversations",
  email: "Project email",
  file: "Files",
  financial: "Financial",
  presence: "Availability",
  schedule: "Schedule",
  social: "Social publishing",
  warranty: "Warranty",
}

type ActivityPageProps = {
  readonly searchParams: Promise<{
    readonly category?: string
    readonly project?: string
  }>
}

function activityTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date)
}

export default async function ActivityPage({
  searchParams,
}: ActivityPageProps): Promise<React.ReactElement> {
  const user = await getCurrentUser()
  if (!user || !isInternalStaffRole(user.role)) {
    redirect("/dashboard/access-restricted")
  }

  const params = await searchParams
  const [events, projects] = await Promise.all([
    getActivityEvents({
      category: params.category,
      projectId: params.project,
    }),
    getProjects(),
  ])

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <div>
          <div className="flex items-center gap-2">
            <IconActivity className="size-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Activity
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Recent staff, owner, subcontractor, and supplier actions in Compass.
          </p>
        </div>
        <form className="flex flex-wrap items-center gap-2">
          <select
            name="category"
            defaultValue={params.category ?? ""}
            aria-label="Filter activity by category"
            className="h-9 border bg-background px-3 text-sm"
          >
            <option value="">All activity</option>
            {ACTIVITY_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
          <SearchableComboboxField
            name="project"
            defaultValue={params.project ?? ""}
            ariaLabel="Filter activity by project"
            placeholder="All projects"
            searchPlaceholder="Search projects..."
            className="h-9 min-w-56"
            options={[
              { value: "", label: "All projects" },
              ...projects.map((project) => ({
                value: project.id,
                label: project.name,
                description: project.projectNumber ?? undefined,
                keywords: project.projectNumber ?? undefined,
              })),
            ]}
          />
          <button
            type="submit"
            className="h-9 border bg-background px-4 text-sm font-medium hover:bg-muted"
          >
            Apply
          </button>
        </form>
      </header>

      <section className="divide-y border-b" aria-label="Compass activity">
        {events.map((event) => (
          <article
            key={event.id}
            className="grid gap-2 py-4 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-start"
          >
            <time
              dateTime={event.createdAt}
              className="text-xs text-muted-foreground"
            >
              {activityTimestamp(event.createdAt)}
            </time>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{event.actorName}</p>
                <Badge variant="outline" className="rounded-sm font-normal">
                  {CATEGORY_LABELS[event.category]}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-foreground/85">
                {event.summary}
              </p>
              <p className="mt-1 text-xs capitalize text-muted-foreground">
                {event.actorRole.replaceAll("_", " ")}
              </p>
            </div>
            {event.projectId && event.projectName ? (
              <Link
                href={`/dashboard/projects/${encodeURIComponent(event.projectId)}`}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {event.projectName}
                <IconChevronRight className="size-3.5" />
              </Link>
            ) : null}
          </article>
        ))}
        {events.length === 0 ? (
          <div className="py-16 text-center">
            <IconActivity className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No matching activity yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              New activity will appear here as people work in Compass.
            </p>
          </div>
        ) : null}
      </section>
    </main>
  )
}
