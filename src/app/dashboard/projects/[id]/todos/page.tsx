export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import { notFound } from "next/navigation"

import {
  getProjectTaskAssigneeOptions,
  type ProjectTaskAssigneeOption,
} from "@/app/actions/project-contacts"
import { getProjectTodos } from "@/app/actions/project-operations"
import { getProjects } from "@/app/actions/projects"
import { ProjectTodosView } from "@/components/projects/project-todos-view"
import { requireAuth } from "@/lib/auth"
import { isDemoUser } from "@/lib/demo"
import { canFeature } from "@/lib/permission-enforcement"

export default async function ProjectTodosPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<{
    readonly item?: string | readonly string[]
    readonly quickAdd?: string | readonly string[]
  }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const id = decodeProjectRouteId(rawProjectId)
  const [projects, items, user] = await Promise.all([
    getProjects(),
    getProjectTodos(id),
    requireAuth(),
  ])
  const project = projects.find((candidate) => candidate.id === id)
  if (!project) notFound()

  const projectLabel = project.projectNumber
    ? `${project.projectNumber} — ${project.name}`
    : project.name
  const initialItemId =
    typeof query.item === "string" ? query.item : query.item?.[0] ?? null
  const quickAdd =
    typeof query.quickAdd === "string" ? query.quickAdd : query.quickAdd?.[0]
  const canManage =
    !isDemoUser(user.id) && (await canFeature(user, "tasks", "update"))
  let assigneeOptions: ProjectTaskAssigneeOption[] = []
  if (canManage) {
    const assigneeData = await getProjectTaskAssigneeOptions(id)
    assigneeOptions = [
      ...assigneeData.projectContacts,
      ...assigneeData.directoryContacts,
    ]
  }

  return (
    <ProjectTodosView
      projectId={id}
      projectLabel={projectLabel}
      items={items}
      initialItemId={initialItemId}
      assigneeOptions={assigneeOptions}
      canManage={canManage}
      initialCreateOpen={quickAdd === "todo"}
    />
  )
}
