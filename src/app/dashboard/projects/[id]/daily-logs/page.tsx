export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"
import { notFound } from "next/navigation"

import { getProjectDailyLogWorkspace } from "@/app/actions/project-field"
import {
  getProjectTaskAssigneeOptions,
  type ProjectTaskAssigneeOption,
} from "@/app/actions/project-contacts"
import { ProjectDailyLogWorkspace } from "@/components/projects/project-daily-log-workspace"
import { redirectIfFeaturePermissionDenied } from "@/lib/permission-redirect"

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

export default async function ProjectDailyLogsPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  let workspace: Awaited<ReturnType<typeof getProjectDailyLogWorkspace>>
  let assigneeOptions: ProjectTaskAssigneeOption[] = []

  try {
    workspace = await getProjectDailyLogWorkspace(id)
  } catch (error) {
    if (hasDigest(error) && error.digest === "NEXT_NOT_FOUND") throw error
    redirectIfFeaturePermissionDenied(error)
    notFound()
  }

  try {
    const assigneeData = await getProjectTaskAssigneeOptions(id)
    assigneeOptions = [
      ...assigneeData.projectContacts,
      ...assigneeData.directoryContacts,
    ]
  } catch (error) {
    console.warn("Unable to load daily-log assignee options", error)
  }

  return (
    <ProjectDailyLogWorkspace
      workspace={workspace}
      assigneeOptions={assigneeOptions}
    />
  )
}
