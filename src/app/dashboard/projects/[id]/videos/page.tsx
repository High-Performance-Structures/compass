export const dynamic = "force-dynamic"

import type * as React from "react"
import { notFound } from "next/navigation"

import { getProjectVideoWorkspace } from "@/app/actions/project-videos"
import { ProjectVideoReview } from "@/components/projects/project-video-review"
import { redirectIfFeaturePermissionDenied } from "@/lib/permission-redirect"

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

export default async function ProjectVideosPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  let workspace: Awaited<ReturnType<typeof getProjectVideoWorkspace>>
  try {
    workspace = await getProjectVideoWorkspace(id)
  } catch (error) {
    if (hasDigest(error)) throw error
    redirectIfFeaturePermissionDenied(error)
    if (error instanceof Error && error.message === "Project not found") notFound()
    throw error
  }
  return <ProjectVideoReview workspace={workspace} />
}
