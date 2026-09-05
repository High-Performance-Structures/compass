import type * as React from "react"

import { getCurrentUser } from "@/lib/auth"
import { getProjects } from "@/app/actions/projects"
import { getQuickAddProjects } from "@/lib/quick-add-server"
import { QuickAddProvider } from "@/components/quick-add-menu"

import { Toaster } from "@/components/ui/sonner"

export default async function PreviewLayout({
  children,
}: {
  readonly children: React.ReactNode
}): Promise<React.ReactElement> {
  const [user, projects] = await Promise.all([getCurrentUser(), getProjects()])
  const quickAddProjects = await getQuickAddProjects(user, projects)
  return (
    <QuickAddProvider projects={quickAddProjects}>
      {children}
      <Toaster position="bottom-right" />
    </QuickAddProvider>
  )
}
