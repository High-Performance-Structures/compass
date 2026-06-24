"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

import type { ProjectListItem } from "@/app/actions/projects"

const ACTIVE_PROJECT_STORAGE_KEY = "compass.activeProjectId"

const ProjectListContext = React.createContext<ProjectListItem[]>([])
const ActiveProjectContext = React.createContext<{
  readonly activeProjectId: string | null
  readonly activeProject: ProjectListItem | null
  readonly activeProjectReady: boolean
  readonly setActiveProjectId: (projectId: string | null) => void
}>({
  activeProjectId: null,
  activeProject: null,
  activeProjectReady: false,
  setActiveProjectId: () => {},
})

export function useProjectList(): ProjectListItem[] {
  return React.useContext(ProjectListContext)
}

export function useActiveProject(): {
  readonly activeProjectId: string | null
  readonly activeProject: ProjectListItem | null
  readonly activeProjectReady: boolean
  readonly setActiveProjectId: (projectId: string | null) => void
} {
  return React.useContext(ActiveProjectContext)
}

function projectIdFromPathname(pathname: string | null): string | null {
  if (!pathname) return null

  const match = pathname.match(/^\/dashboard\/projects\/([^/?#]+)(?:\/|$)/)
  const projectId = match?.[1] ?? null
  return projectId === "select" ? null : projectId
}

export function ProjectListProvider({
  projects,
  children,
}: {
  readonly projects: ProjectListItem[]
  readonly children: React.ReactNode
}) {
  const pathname = usePathname()
  const [activeProjectId, setActiveProjectIdState] = React.useState<
    string | null
  >(null)
  const [activeProjectReady, setActiveProjectReady] = React.useState(false)

  const projectIds = React.useMemo(
    () => new Set(projects.map((project) => project.id)),
    [projects]
  )

  const setActiveProjectId = React.useCallback(
    (projectId: string | null) => {
      const nextProjectId =
        projectId && projectIds.has(projectId) ? projectId : null
      setActiveProjectIdState(nextProjectId)

      try {
        if (nextProjectId) {
          window.localStorage.setItem(
            ACTIVE_PROJECT_STORAGE_KEY,
            nextProjectId
          )
        } else {
          window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY)
        }
      } catch {
        // Browser storage may be unavailable in locked-down contexts.
      }
    },
    [projectIds]
  )

  React.useEffect(() => {
    try {
      const storedProjectId = window.localStorage.getItem(
        ACTIVE_PROJECT_STORAGE_KEY
      )
      if (storedProjectId && projectIds.has(storedProjectId)) {
        setActiveProjectIdState(storedProjectId)
      } else if (storedProjectId) {
        window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY)
      }
    } catch {
      // Browser storage may be unavailable in locked-down contexts.
    } finally {
      setActiveProjectReady(true)
    }
  }, [projectIds])

  React.useEffect(() => {
    const routeProjectId = projectIdFromPathname(pathname)
    if (routeProjectId && projectIds.has(routeProjectId)) {
      setActiveProjectId(routeProjectId)
    }
  }, [pathname, projectIds, setActiveProjectId])

  const activeProject =
    projects.find((project) => project.id === activeProjectId) ?? null
  const activeValue = React.useMemo(
    () => ({
      activeProjectId,
      activeProject,
      activeProjectReady,
      setActiveProjectId,
    }),
    [
      activeProjectId,
      activeProject,
      activeProjectReady,
      setActiveProjectId,
    ]
  )

  return (
    <ProjectListContext.Provider value={projects}>
      <ActiveProjectContext.Provider value={activeValue}>
        {children}
      </ActiveProjectContext.Provider>
    </ProjectListContext.Provider>
  )
}
