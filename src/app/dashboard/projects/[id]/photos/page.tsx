export const dynamic = "force-dynamic"

import type * as React from "react"
import { notFound } from "next/navigation"

import { getProjectPhotoLibrary } from "@/app/actions/project-photos"
import { ProjectPhotoReview } from "@/components/projects/project-photo-review"

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
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
    if (hasDigest(error) && error.digest === "NEXT_NOT_FOUND") throw error
    notFound()
  }

  return <ProjectPhotoReview library={library} />
}
