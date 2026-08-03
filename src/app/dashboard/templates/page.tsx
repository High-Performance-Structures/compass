import { getProjectTemplateLibrary } from "@/app/actions/project-templates"
import { TemplateLibraryView } from "@/components/templates/template-library-view"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

export const dynamic = "force-dynamic"

export default async function TemplateLibraryPage() {
  const [templates, user] = await Promise.all([
    getProjectTemplateLibrary(),
    getCurrentUser(),
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
      canManage={canManage}
      canCreateEstimate={canCreateEstimate}
    />
  )
}
