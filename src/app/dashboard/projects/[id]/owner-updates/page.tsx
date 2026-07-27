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
  getOwnerUpdateProjectHeader,
  getProjectOwnerUpdates,
  type ProjectOwnerUpdateListItem,
} from "@/app/actions/project-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { getCurrentUser } from "@/lib/auth"
import { redirectIfFeaturePermissionDenied } from "@/lib/permission-redirect"
import { isInternalStaffRole } from "@/lib/user-roles"

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

function OwnerUpdateLink({
  baseHref,
  update,
}: {
  readonly baseHref: string
  readonly update: ProjectOwnerUpdateListItem
}): React.ReactElement {
  return (
    <Link
      href={`${baseHref}/${update.id}`}
      className="group block rounded-lg border p-4 transition-colors hover:bg-accent/40"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={update.status === "draft" ? "secondary" : "outline"}>
              {update.status}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {formatDate(update.updateDate)}
            </span>
            <Badge variant="outline">{update.channel}</Badge>
          </div>
          <h3 className="mt-2 text-base font-semibold">{update.title}</h3>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            {update.summary}
          </p>
        </div>
        <IconArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  )
}

export default async function ProjectOwnerUpdatesPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  const currentUser = await getCurrentUser()
  const internalViewer =
    currentUser !== null && isInternalStaffRole(currentUser.role)
  let project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
  }
  let summary: {
    readonly ownerUpdateCount: number
    readonly draftOwnerUpdateCount: number
    readonly ownerVisiblePhotoCount: number
  }
  let ownerUpdates: Awaited<ReturnType<typeof getProjectOwnerUpdates>>

  try {
    if (internalViewer) {
      const [workspace, fieldSummary, updates] = await Promise.all([
        getProjectDailyLogWorkspace(id),
        getProjectFieldSummary(id),
        getProjectOwnerUpdates(id),
      ])
      project = workspace.project
      summary = fieldSummary
      ownerUpdates = updates
    } else {
      const [header, updates] = await Promise.all([
        getOwnerUpdateProjectHeader(id),
        getProjectOwnerUpdates(id),
      ])
      project = header
      ownerUpdates = updates
      summary = {
        ownerUpdateCount: updates.length,
        draftOwnerUpdateCount: 0,
        ownerVisiblePhotoCount: 0,
      }
    }
  } catch (error) {
    if (hasDigest(error) && error.digest === "NEXT_NOT_FOUND") throw error
    redirectIfFeaturePermissionDenied(error)
    notFound()
  }

  const projectLabel =
    project.projectNumber ?? project.name
  const baseHref = `/dashboard/projects/${project.id}/owner-updates`
  const draftUpdates = ownerUpdates.filter(
    (update) => update.status === "draft"
  )
  const historicalUpdates = ownerUpdates.filter(
    (update) => update.status !== "draft"
  )

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/projects/${project.id}`}
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
            {internalViewer
              ? "Draft, review, and publish owner-facing updates."
              : "View published project updates and progress history."}
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <ProjectContextSwitcher
            currentProjectId={project.id}
            targetSection="owner-updates"
            placeholder="Switch owner update project..."
            className="w-full sm:w-[280px]"
          />
          {internalViewer && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button asChild>
                <Link
                  href={`/dashboard/projects/${project.id}/daily-logs#owner-update-builder`}
                >
                  <IconClipboardText className="size-4" />
                  Build From Logs
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/dashboard/projects/${project.id}/photos`}>
                  <IconPhoto className="size-4" />
                  Review Photos
                </Link>
              </Button>
            </div>
          )}
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
          {internalViewer ? (
            <>
              <p className="text-xl font-semibold tabular-nums">
                {summary.ownerVisiblePhotoCount}
              </p>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Owner photos
              </p>
            </>
          ) : (
            <>
              <p className="text-xl font-semibold tabular-nums">
                {summary.ownerUpdateCount}
              </p>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Published
              </p>
            </>
          )}
        </div>
      </section>

      {draftUpdates.length > 0 && (
        <Card className="rounded-lg">
          <CardHeader>
            <div className="flex items-center gap-2">
              <IconClipboardText className="size-5 text-muted-foreground" />
              <CardTitle>Draft Updates</CardTitle>
            </div>
            <CardDescription>
              Staff-only updates that can be opened, reviewed, and published.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {draftUpdates.map((update) => (
              <OwnerUpdateLink
                key={update.id}
                baseHref={baseHref}
                update={update}
              />
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="rounded-lg">
        <CardHeader>
          <div className="flex items-center gap-2">
            <IconMailForward className="size-5 text-muted-foreground" />
            <CardTitle>Update History</CardTitle>
          </div>
          <CardDescription>
            Published and sent updates remain available to staff and project
            owners for historical progress reference.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {historicalUpdates.length > 0 ? (
            historicalUpdates.map((update) => (
              <OwnerUpdateLink
                key={update.id}
                baseHref={baseHref}
                update={update}
              />
            ))
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No published owner updates are available yet.
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
