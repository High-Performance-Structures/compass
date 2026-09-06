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

export default async function PreviewLayout({
  children,
}: {
  readonly children: React.ReactNode
}): Promise<React.ReactElement> {
  const [user, projects] = await Promise.all([getCurrentUser(), getProjects()])
  const [quickAddProjects, helpAccess] = await Promise.all([
    getQuickAddProjects(user, projects),
    getEffectiveHelpGuideAccess(user),
  ])
  const allowedHelpGuideIds = new Set(helpAccess.allowedGuideIds)
  const helpGuides = getHelpGuides()
    .filter((guide) => allowedHelpGuideIds.has(guide.id))
    .map(toHelpGuidePreview)

  return (
    <HelpUiProvider guides={helpGuides} canUseJarvis={false}>
      <QuickAddProvider projects={quickAddProjects}>
        {children}
        <Toaster position="bottom-right" />
      </QuickAddProvider>
    </HelpUiProvider>
  )
}
