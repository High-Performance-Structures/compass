import { getProjectAudienceRequestScope, resolveProjectAudienceViewer, recordProjectAudiencePreviewVisit } from "@/lib/project-audience-viewer"
import { ProjectAudiencePersonSelector } from "@/components/projects/project-audience-person-selector"
import { ProjectAudiencePreviewScope } from "@/components/projects/project-audience-preview-scope"
import type * as React from "react"

import { getCurrentUser } from "@/lib/auth"
import { getProjects } from "@/app/actions/projects"
import { getQuickAddProjects } from "@/lib/quick-add-server"
import { QuickAddProvider } from "@/components/quick-add-menu"
import { HelpUiProvider } from "@/components/help/help-ui-provider"
import { toHelpGuidePreview } from "@/components/help/help-ui-model"
import { getHelpGuides } from "@/lib/help"
import { getEffectiveHelpGuideAccess } from "@/lib/help/server-access"

import { Toaster } from "@/components/ui/sonner"
import { DepartmentProfilesProvider } from "@/components/branding/department-profiles-provider"
import { currentDepartmentProfiles } from "@/lib/department-profiles-server"

export default async function PreviewLayout({
  children,
}: {
  readonly children: React.ReactNode
}): Promise<React.ReactElement> {
  const scope = await getProjectAudienceRequestScope()
  const context = scope ? await resolveProjectAudienceViewer(scope.projectId, scope.audience) : null
  if (context) await recordProjectAudiencePreviewVisit(context)
  const user = context?.viewer ?? (context?.isPreview ? null : await getCurrentUser())
  const projects = context?.isPreview ? [] : await getProjects()
  const [quickAddProjects, helpAccess] = await Promise.all([
    context?.isPreview ? Promise.resolve([]) : getQuickAddProjects(user, projects),
    getEffectiveHelpGuideAccess(user),
  ])
  const allowedHelpGuideIds = new Set(helpAccess.allowedGuideIds)
  const helpGuides = getHelpGuides()
    .filter((guide) => allowedHelpGuideIds.has(guide.id))
    .map(toHelpGuidePreview)

  const departmentProfiles = await currentDepartmentProfiles()
  return (
    <DepartmentProfilesProvider profiles={departmentProfiles}>
    <HelpUiProvider guides={helpGuides} canUseJarvis={false}>
      <QuickAddProvider projects={quickAddProjects}>
        {context?.isPreview && <div className="border-b bg-warning/10 px-4 py-3 text-warning">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium">{context.viewer ? `Previewing as ${context.viewer.displayName ?? context.viewer.email}` : "Choose an external person"} · {context.audience === "owner" ? "Owner" : "Vendor"} · Read only</p>
            <ProjectAudiencePersonSelector projectId={context.projectId} audience={context.audience} selectedUserId={context.viewer?.id ?? null} options={context.previewOptions} />
          </div>
        </div>}
        <ProjectAudiencePreviewScope readOnly={context?.isPreview ?? false} canonicalScope={context ? { projectId: context.projectId, audience: context.audience, targetUserId: context.viewer?.id ?? null } : undefined}>
          {context?.isPreview && !context.viewer ? <main className="p-6"><p className="text-sm text-muted-foreground">Select an assigned owner or vendor above to see their workspace, including the messages and files they can access. No personal records are combined in this view.</p></main> : children}
        </ProjectAudiencePreviewScope>
        <Toaster position="bottom-right" />
      </QuickAddProvider>
    </HelpUiProvider>
    </DepartmentProfilesProvider>
  )
}
