export const dynamic = "force-dynamic"

import type * as React from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import {
  IconArrowRight,
  IconClipboardText,
  IconMailForward,
  IconPhoto,
} from "@tabler/icons-react"

import {
  getProjectDailyLogWorkspace,
  getProjectFieldSummary,
  getProjectOwnerUpdates,
  type ProjectOwnerUpdateListItem,
} from "@/app/actions/project-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ProjectListFilters } from "@/components/projects/project-list-filters"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

function formatDate(value: string | null): string {
  if (!value) return "No date"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function paramValue(value: string | readonly string[] | undefined): string {
  if (typeof value === "string") return value
  return value?.[0] ?? ""
}

function matchesText(
  values: readonly (string | null | undefined)[],
  query: string
): boolean {
  const normalized = query.trim().toLowerCase()
  if (normalized.length === 0) return true

  return values.some((value) =>
    (value ?? "").toLowerCase().includes(normalized)
  )
}

function matchesDateRange(value: string | null, from: string, to: string): boolean {
  if (from.length === 0 && to.length === 0) return true
  if (!value) return false
  return (from.length === 0 || value >= from) && (to.length === 0 || value <= to)
}

function matchesOwnerUpdateFilters(
  update: ProjectOwnerUpdateListItem,
  filters: {
    readonly q: string
    readonly status: string
    readonly from: string
    readonly to: string
  }
): boolean {
  const statusMatches =
    filters.status.length === 0 ||
    filters.status === "all" ||
    update.status === filters.status
  return (
    statusMatches &&
    matchesDateRange(update.updateDate, filters.from, filters.to) &&
    matchesText(
      [update.title, update.summary, update.channel, update.status],
      filters.q
    )
  )
}

export default async function ProjectOwnerUpdatesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<{
    readonly q?: string | readonly string[]
    readonly status?: string | readonly string[]
    readonly from?: string | readonly string[]
    readonly to?: string | readonly string[]
  }>
}): Promise<React.ReactElement> {
  const { id } = await params
  const query = await searchParams
  let workspace: Awaited<ReturnType<typeof getProjectDailyLogWorkspace>>
  let summary: Awaited<ReturnType<typeof getProjectFieldSummary>>
  let ownerUpdates: Awaited<ReturnType<typeof getProjectOwnerUpdates>>

  try {
    ;[workspace, summary, ownerUpdates] = await Promise.all([
      getProjectDailyLogWorkspace(id),
      getProjectFieldSummary(id),
      getProjectOwnerUpdates(id),
    ])
  } catch (error) {
    if (hasDigest(error) && error.digest === "NEXT_NOT_FOUND") throw error
    notFound()
  }

  const projectLabel =
    workspace.project.projectNumber ?? workspace.project.name
  const filters = {
    q: paramValue(query.q),
    status: paramValue(query.status),
    from: paramValue(query.from),
    to: paramValue(query.to),
  }
  const filteredOwnerUpdates = ownerUpdates.filter((update) =>
    matchesOwnerUpdateFilters(update, filters)
  )
  const baseHref = `/dashboard/projects/${workspace.project.id}/owner-updates`

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/projects/${workspace.project.id}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {projectLabel}
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm font-medium">Owner Updates</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">
            Owner Updates
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Draft, review, and publish owner-facing updates.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <ProjectContextSwitcher
            currentProjectId={workspace.project.id}
            targetSection="owner-updates"
            placeholder="Switch owner update project..."
            className="w-full sm:w-[280px]"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button asChild>
              <Link href={`/dashboard/projects/${workspace.project.id}/daily-logs`}>
                <IconClipboardText className="size-4" />
                Build From Logs
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/dashboard/projects/${workspace.project.id}/photos`}>
                <IconPhoto className="size-4" />
                Review Photos
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <section className="grid grid-cols-3 gap-x-5 gap-y-2 border-y py-3">
        <div>
          <p className="text-xl font-semibold tabular-nums">
            {summary.ownerUpdateCount}
          </p>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Total updates
          </p>
        </div>
        <div>
          <p className="text-xl font-semibold tabular-nums">
            {summary.draftOwnerUpdateCount}
          </p>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Drafts
          </p>
        </div>
        <div>
          <p className="text-xl font-semibold tabular-nums">
            {summary.ownerVisiblePhotoCount}
          </p>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Owner photos
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3 border-y py-3">
          <div>
            <div className="flex items-center gap-2">
              <IconMailForward className="size-5 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Owner update queue</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Open any update, then return here without leaving this project area.
            </p>
          </div>
        </div>

        <ProjectListFilters
          baseHref={baseHref}
          q={filters.q}
          status={filters.status}
          from={filters.from}
          to={filters.to}
          statusOptions={[
            { value: "all", label: "All statuses" },
            { value: "draft", label: "Draft" },
            { value: "published", label: "Published" },
            { value: "sent", label: "Sent" },
          ]}
          searchPlaceholder="Search updates, summaries, channel..."
          resultLabel={`${filteredOwnerUpdates.length} of ${ownerUpdates.length} update${
            ownerUpdates.length === 1 ? "" : "s"
          } shown`}
        />

        {filteredOwnerUpdates.length > 0 ? (
          filteredOwnerUpdates.map((update) => (
            <Link
              key={update.id}
              href={`${baseHref}/${update.id}`}
              className="group block border-l-2 border-y border-r border-l-[#3f7d4d] bg-background px-4 py-3 transition-colors hover:bg-accent/35"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{update.status}</Badge>
                    <span className="text-sm text-muted-foreground">
                      {formatDate(update.updateDate)}
                    </span>
                    <Badge variant="outline">{update.channel}</Badge>
                  </div>
                  <h2 className="mt-2 text-base font-semibold">
                    {update.title}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                    {update.summary}
                  </p>
                </div>
                <IconArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          ))
        ) : (
          <div className="rounded-lg border bg-background p-8 text-center">
            <IconMailForward className="mx-auto size-6 text-muted-foreground" />
            <h2 className="mt-3 text-sm font-semibold">
              No owner updates found
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Clear the filters or build a new update from Daily Logs.
            </p>
          </div>
        )}
      </section>
    </main>
  )
}
