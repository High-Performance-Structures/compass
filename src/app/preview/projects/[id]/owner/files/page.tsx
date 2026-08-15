import type * as React from "react"

import { ProjectAudienceFilesRoute } from "@/components/projects/project-audience-files-route"

export default async function OwnerProjectFilesPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  return <ProjectAudienceFilesRoute projectId={id} audience="owner" />
}
