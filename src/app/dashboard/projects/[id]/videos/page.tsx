export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"
import { notFound } from "next/navigation"

import { getProjectVideoWorkspace } from "@/app/actions/project-videos"
import { ProjectVideoReview } from "@/components/projects/project-video-review"
import { permissionDeniedRedirectHref } from "@/lib/permission-redirect"
import { ClientRedirect } from "@/components/client-redirect"

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

export default async function ProjectVideosPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  let workspace: Awaited<ReturnType<typeof getProjectVideoWorkspace>>
  try {
    workspace = await getProjectVideoWorkspace(id)
  } catch (error) {
    if (hasDigest(error)) throw error
    const deniedHref = permissionDeniedRedirectHref(error)
    if (deniedHref) return <ClientRedirect href={deniedHref} />
    if (error instanceof Error && error.message === "Project not found") notFound()
    throw error
  }
  return <ProjectVideoReview workspace={workspace} />
}
