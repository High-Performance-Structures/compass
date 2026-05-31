"use client"

import * as React from "react"

import type { ProjectListItem } from "@/app/actions/projects"

const ProjectListContext = React.createContext<ProjectListItem[]>([])

export function useProjectList(): ProjectListItem[] {
  return React.useContext(ProjectListContext)
}

export function ProjectListProvider({
  projects,
  children,
}: {
  readonly projects: ProjectListItem[]
  readonly children: React.ReactNode
}) {
  return (
    <ProjectListContext.Provider value={projects}>
      {children}
    </ProjectListContext.Provider>
  )
}
