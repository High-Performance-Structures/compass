export const dynamic = "force-dynamic"

import type * as React from "react"
import { notFound } from "next/navigation"

import { getProjectDailyLogWorkspace } from "@/app/actions/project-field"
import { ProjectDailyLogWorkspace } from "@/components/projects/project-daily-log-workspace"

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

export default async function ProjectDailyLogsPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  let workspace: Awaited<ReturnType<typeof getProjectDailyLogWorkspace>>

  try {
    workspace = await getProjectDailyLogWorkspace(id)
  } catch (error) {
    if (hasDigest(error) && error.digest === "NEXT_NOT_FOUND") throw error
    notFound()
  }

  return <ProjectDailyLogWorkspace workspace={workspace} />
}
