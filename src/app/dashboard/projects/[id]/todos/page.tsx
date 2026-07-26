export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"

import { getProjectOperationsSummary } from "@/app/actions/project-operations"
import { getProjects } from "@/app/actions/projects"
import { ProjectTodosView } from "@/components/projects/project-todos-view"

export default async function ProjectTodosPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<{
    readonly item?: string | readonly string[]
  }>
}): Promise<React.ReactElement> {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const [projects, summary] = await Promise.all([
    getProjects(),
    getProjectOperationsSummary(id),
  ])
  const project = projects.find((candidate) => candidate.id === id)
  if (!project) notFound()

  const projectLabel = project.projectNumber
    ? `${project.projectNumber} — ${project.name}`
    : project.name
  const initialItemId =
    typeof query.item === "string" ? query.item : query.item?.[0] ?? null

  return (
    <ProjectTodosView
      projectLabel={projectLabel}
      items={summary.commitments}
      initialItemId={initialItemId}
    />
  )
}
