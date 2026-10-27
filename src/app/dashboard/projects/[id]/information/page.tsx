export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import { notFound } from "next/navigation"

import { FieldCostCodeEditor } from "@/components/settings/field-cost-code-editor"
import { isInternalStaffRole } from "@/lib/user-roles"
import { getCurrentUser } from "@/lib/auth"
import { canManageProjectRegistry } from "@/lib/permissions"
import {
  getProjectFollowUpOwners,
  getProjectInformation,
} from "@/app/actions/project-profile"
import { ProjectInformationWorkspace } from "@/components/projects/project-information-workspace"
import { getProjectTravelCharge } from "@/app/actions/project-travel-charges"
import { ProjectZoneCharges } from "@/components/projects/project-zone-charges"
import { ProjectWorkspaceSettings } from "@/components/projects/project-workspace-settings"
import { currentInternalDepartment } from "@/lib/department-profiles-server"

export default async function ProjectInformationPage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  const [information, followUpOwners, currentUser, zoneCharges, internalDepartment] = await Promise.all([
    getProjectInformation(id),
    getProjectFollowUpOwners(id),
    getCurrentUser(),
    getProjectTravelCharge(id),
    currentInternalDepartment(),
  ])
  if (!information) notFound()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4 md:p-6">
      <ProjectInformationWorkspace
        information={information}
        followUpOwners={followUpOwners}
        canManageJobStatuses={canManageProjectRegistry(currentUser)}
      />
      <ProjectWorkspaceSettings
        projectId={id}
        workspaceKind={information.project.workspaceKind}
        internalDepartment={information.project.internalDepartment}
        internalDepartmentName={internalDepartment.name}
      />
      {currentUser && isInternalStaffRole(currentUser.role) ? <FieldCostCodeEditor scope="project" projectId={id} /> : null}
      {zoneCharges ? <ProjectZoneCharges projectId={id} view={zoneCharges} /> : null}
    </div>
  )
}
