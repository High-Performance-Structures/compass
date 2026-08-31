export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"
import { notFound } from "next/navigation"

import { getSocialPostWorkspace } from "@/app/actions/social-posts"
import { ProjectSocialWorkspace } from "@/components/projects/project-social-workspace"
import { redirectIfFeaturePermissionDenied } from "@/lib/permission-redirect"

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

export default async function ProjectSocialPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  let workspace: Awaited<ReturnType<typeof getSocialPostWorkspace>>
  try {
    workspace = await getSocialPostWorkspace(id)
  } catch (error) {
    if (hasDigest(error)) throw error
    redirectIfFeaturePermissionDenied(error)
    if (error instanceof Error && error.message.includes("Project not found")) notFound()
    throw error
  }
  return <ProjectSocialWorkspace workspace={workspace} />
}
