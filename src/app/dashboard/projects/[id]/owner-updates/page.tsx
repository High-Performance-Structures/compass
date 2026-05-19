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

export default async function ProjectOwnerUpdatesPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  let workspace: Awaited<ReturnType<typeof getProjectDailyLogWorkspace>>
  let summary: Awaited<ReturnType<typeof getProjectFieldSummary>>

  try {
    ;[workspace, summary] = await Promise.all([
      getProjectDailyLogWorkspace(id),
      getProjectFieldSummary(id),
    ])
  } catch (error) {
    if (hasDigest(error) && error.digest === "NEXT_NOT_FOUND") throw error
    notFound()
  }

  const projectLabel =
    workspace.project.projectNumber ?? workspace.project.name
  const latestUpdate = summary.latestOwnerUpdate

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
            A dedicated publishing queue for owner-facing updates generated
            from approved daily logs and owner-visible photos.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="rounded-lg">
          <CardHeader>
            <CardDescription>Total updates</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {summary.ownerUpdateCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="rounded-lg border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20">
          <CardHeader>
            <CardDescription>Drafts</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {summary.draftOwnerUpdateCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="rounded-lg border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/20">
          <CardHeader>
            <CardDescription>Owner-visible photos</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {summary.ownerVisiblePhotoCount}
            </CardTitle>
          </CardHeader>
        </Card>
      </section>

      <Card className="rounded-lg">
        <CardHeader>
          <div className="flex items-center gap-2">
            <IconMailForward className="size-5 text-muted-foreground" />
            <CardTitle>Latest Owner Update</CardTitle>
          </div>
          <CardDescription>
            This page is the build-out home for the owner update queue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {latestUpdate ? (
            <Link
              href={
                `/dashboard/projects/${workspace.project.id}` +
                `/owner-updates/${latestUpdate.id}`
              }
              className="group block rounded-lg border p-4 transition-colors hover:bg-accent/40"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      {latestUpdate.status}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {formatDate(latestUpdate.updateDate)}
                    </span>
                  </div>
                  <h2 className="mt-2 text-lg font-semibold">
                    {latestUpdate.title}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                    {latestUpdate.summary}
                  </p>
                </div>
                <IconArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No owner updates have been drafted for this project yet. Start
              from Daily Logs when approved field notes are ready.
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
