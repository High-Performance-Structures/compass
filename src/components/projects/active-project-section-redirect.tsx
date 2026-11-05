"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { useActiveProject } from "@/components/project-list-provider"
import { Button } from "@/components/ui/button"

function sectionHref(projectId: string, targetSection: string): string {
  return `/dashboard/projects/${projectId}/${targetSection}`
}

export function ActiveProjectSectionRedirect({
  targetSection,
  label,
}: {
  readonly targetSection: string
  readonly label: string
}): React.ReactElement | null {
  const router = useRouter()
  const { activeProject, activeProjectReady } = useActiveProject()
  const href = activeProject
    ? sectionHref(activeProject.id, targetSection)
    : null

  React.useEffect(() => {
    if (!activeProjectReady || !href) return
    router.replace(href)
  }, [activeProjectReady, href, router])

  if (!activeProjectReady || !href || !activeProject) return null

  return (
    <div className="rounded-lg border bg-background p-3 text-sm shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">Continuing in {activeProject.name}</p>
          {activeProject.projectNumber && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {activeProject.projectNumber}
            </p>
          )}
        </div>
        <Button asChild size="sm">
          <Link href={href}>{label}</Link>
        </Button>
      </div>
    </div>
  )
}

/**
 * A visible shortcut into the active project's section, without leaving the
 * page on its own (for company-wide pages such as the ordering queue).
 */
export function ActiveProjectSectionShortcut({
  targetSection,
  noun,
}: {
  readonly targetSection: string
  /** What the section holds, such as "POs": the button reads "Open <project> POs". */
  readonly noun: string
}): React.ReactElement | null {
  const { activeProject, activeProjectReady } = useActiveProject()
  if (!activeProjectReady || !activeProject) return null
  const name = activeProject.projectNumber ?? activeProject.name
  return (
    <Button asChild size="sm" variant="outline">
      <Link href={sectionHref(activeProject.id, targetSection)}>
        Open {name} {noun}
      </Link>
    </Button>
  )
}
