export const dynamic = "force-dynamic"

import type * as React from "react"
import { notFound } from "next/navigation"

import { getProjectPhotoLibrary } from "@/app/actions/project-photos"
import { ProjectPhotoReview } from "@/components/projects/project-photo-review"
import { redirectIfFeaturePermissionDenied } from "@/lib/permission-redirect"

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

function isProjectNotFound(error: unknown): boolean {
  return error instanceof Error && error.message === "Project not found"
}

export default async function ProjectPhotosPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  let library: Awaited<ReturnType<typeof getProjectPhotoLibrary>>

  try {
    library = await getProjectPhotoLibrary(id)
  } catch (error) {
    if (hasDigest(error)) throw error
    redirectIfFeaturePermissionDenied(error)
    if (isProjectNotFound(error)) notFound()
    throw error
  }

  return <ProjectPhotoReview library={library} />
}
