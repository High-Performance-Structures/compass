import { redirect } from "next/navigation"

import {
  HelpResourcesLibrary,
  type HelpGuideSummary,
} from "@/components/help/help-resources-library"
import { toHelpGuidePreview } from "@/components/help/help-ui-model"
import { getCurrentUser } from "@/lib/auth"
import { getHelpGuides } from "@/lib/help"
import { getEffectiveHelpGuideAccess } from "@/lib/help/server-access"

export const dynamic = "force-dynamic"

export default async function HelpResourcesPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser()
  const helpAccess = await getEffectiveHelpGuideAccess(user)

  if (!helpAccess.canViewHelp) {
    redirect("/dashboard/access-restricted?feature=help-resources&action=view")
  }

  const allowedGuideIds = new Set(helpAccess.allowedGuideIds)
  const accessibleGuides = getHelpGuides().filter((guide) =>
    allowedGuideIds.has(guide.id)
  )
  const guides: readonly HelpGuideSummary[] = accessibleGuides.map(toHelpGuidePreview)

  return <HelpResourcesLibrary guides={guides} />
}
