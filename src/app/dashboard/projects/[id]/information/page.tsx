export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"

import { getCurrentUser } from "@/lib/auth"
import { canManageProjectRegistry } from "@/lib/permissions"
import {
  getProjectFollowUpOwners,
  getProjectInformation,
} from "@/app/actions/project-profile"
import { ProjectInformationWorkspace } from "@/components/projects/project-information-workspace"
import { decodedLegacyProjectId } from "@/lib/legacy-project-route"

export default async function ProjectInformationPage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}): Promise<React.ReactElement> {
  const { id: routeId } = await params
  const id = decodedLegacyProjectId(routeId) ?? routeId
  const [information, followUpOwners, currentUser] = await Promise.all([
    getProjectInformation(id),
    getProjectFollowUpOwners(id),
    getCurrentUser(),
  ])
  if (!information) notFound()

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <ProjectInformationWorkspace
        information={information}
        followUpOwners={followUpOwners}
        canManageJobStatuses={canManageProjectRegistry(currentUser)}
      />
    </div>
  )
}
