"use client"

// One department's lane on the all-departments Projects view: header,
// count, select toggle and the first few project cards.

import * as React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ProjectSelectionToggle } from "@/components/projects/project-bulk-selection"
import {
  type DepartmentId,
  type DepartmentGroup,
  departmentBorderClassName,
  departmentHeaderClassName,
} from "./projects-hub-model"
import { DepartmentMark } from "./projects-hub-departments"
import { ProjectCard } from "./projects-hub-project-card"

export function DepartmentLane({
  group,
  activeDepartment,
}: {
  readonly group: DepartmentGroup
  readonly activeDepartment: DepartmentId | "ALL"
}): React.ReactElement {
  const isFiltered = activeDepartment !== "ALL"
  const visibleProjects = isFiltered ? group.projects : group.projects.slice(0, 5)

  return (
    <section
      id={`department-${group.id}`}
      className={cn(
        "clarity-panel-strong scroll-mt-20 overflow-hidden border-l-[8px]",
        departmentBorderClassName(group.id),
        departmentHeaderClassName(group.id)
      )}
    >
      <div className="clarity-section-header flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <DepartmentMark department={group} />
            <div>
              <h2 className="text-sm font-semibold">{group.label}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {group.description}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tabular-nums">
            {group.projects.length}
            <span className="ml-1 text-xs font-medium text-muted-foreground">
              projects
            </span>
          </span>
          <ProjectSelectionToggle visibleProjectIds={visibleProjects.map((project) => project.id)} />
          {!isFiltered && group.projects.length > visibleProjects.length && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/dashboard/projects?department=${group.id}`}>
                View all
              </Link>
            </Button>
          )}
        </div>
      </div>

      {visibleProjects.length > 0 ? (
        <div className="grid gap-3 p-3 xl:grid-cols-2">
          {visibleProjects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <div className="m-3 rounded-md border border-dashed bg-background/70 p-4 text-sm text-muted-foreground">
          No projects in this lane yet.
        </div>
      )}
    </section>
  )
}
