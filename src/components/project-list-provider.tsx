"use client"

import * as React from "react"

type Project = { id: string; name: string }

const ProjectListContext = React.createContext<Project[]>([])

export function useProjectList() {
  return React.useContext(ProjectListContext)
}

export function ProjectListProvider({
  projects,
  children,
}: {
  projects: Project[]
  children: React.ReactNode
}) {
  return (
    <ProjectListContext.Provider value={projects}>
      {children}
    </ProjectListContext.Provider>
  )
}
