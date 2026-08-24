import { getEstimateTextTemplateLibrary } from "@/app/actions/estimate-text-templates"
import { getProjectTemplateLibrary } from "@/app/actions/project-templates"
import { TemplateLibraryView } from "@/components/templates/template-library-view"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"
import { getContractTemplateLibrary } from "@/app/actions/contract-templates"

export const dynamic = "force-dynamic"

export default async function TemplateLibraryPage() {
  const user = await getCurrentUser()
  const canViewEstimateText =
    Boolean(user && isInternalStaffRole(user.role)) &&
    can(user, "budget", "read")
  const [templates, estimateTextTemplates, contractTemplates] = await Promise.all([
    getProjectTemplateLibrary(),
    canViewEstimateText ? getEstimateTextTemplateLibrary() : Promise.resolve([]),
    canViewEstimateText ? getContractTemplateLibrary() : Promise.resolve([]),
  ])
  const canManage =
    Boolean(user && isInternalStaffRole(user.role)) &&
    can(user, "schedule", "update")
  const canCreateEstimate =
    Boolean(user && isInternalStaffRole(user.role)) &&
    can(user, "budget", "update")
  return (
    <TemplateLibraryView
      templates={templates}
      estimateTextTemplates={estimateTextTemplates}
      canManage={canManage}
      canCreateEstimate={canCreateEstimate}
      canManageEstimateText={canCreateEstimate}
      contractTemplates={contractTemplates}
    />
  )
}
