export const dynamic = "force-dynamic"

import type * as React from "react"
import { notFound } from "next/navigation"

import {
  getProjectAudiencePreview,
  type ProjectAudiencePreview as ProjectAudiencePreviewData,
} from "@/app/actions/project-audience-preview"
import { ProjectAudiencePreview } from "@/components/projects/project-audience-preview"

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

export default async function OwnerPreviewPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  let data: ProjectAudiencePreviewData

  try {
    data = await getProjectAudiencePreview(id, "owner")
  } catch (error) {
    if (hasDigest(error) && error.digest === "NEXT_NOT_FOUND") throw error
    notFound()
  }

  return <ProjectAudiencePreview data={data} />
}
