"use client"

// The single-department view of the Projects page: department summary
// counts, quick tools, and every matching project card.

import * as React from "react"
import Link from "next/link"
import { IconExternalLink } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ProjectSelectionToggle } from "@/components/projects/project-bulk-selection"
import {
  type DepartmentGroup,
  type DepartmentTool,
  departmentBorderClassName,
  departmentHeaderClassName,
  toolsForDepartment,
  countByStatusBucket,
} from "./projects-hub-model"
import { DepartmentMark } from "./projects-hub-departments"
import { ProjectCard } from "./projects-hub-project-card"

function DepartmentToolButton({
  tool,
}: {
  readonly tool: DepartmentTool
}): React.ReactElement {
  if (!tool.href) {
    return (
      <Button type="button" variant="outline" disabled>
        {tool.label}
      </Button>
    )
  }

  return (
    <Button variant="outline" asChild>
      <Link href={tool.href}>
        <IconExternalLink className="size-4" />
        {tool.label}
      </Link>
    </Button>
  )
}

export function DepartmentLanding({
  group,
  canOpenTools,
}: {
  readonly group: DepartmentGroup
  readonly canOpenTools: boolean
}): React.ReactElement {
  const tools = toolsForDepartment(group.id)
  const activeCount = countByStatusBucket(group.allProjects, "active")
  const warrantyCount = countByStatusBucket(group.allProjects, "warranty")
  const completeCount = countByStatusBucket(group.allProjects, "complete")
  const needsStatusCleanupCount = countByStatusBucket(group.allProjects, "other")

  return (
    <section
      className={cn(
        "clarity-panel-strong overflow-hidden border-l-[8px]",
        departmentBorderClassName(group.id),
        departmentHeaderClassName(group.id)
      )}
    >
      <div className="grid gap-4 border-b bg-background/70 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.45fr)]">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <DepartmentMark department={group} />
            <div>
              <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
                Department hub
              </p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">
                {group.label}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {group.description}
              </p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-4 overflow-hidden rounded-md border bg-card text-center text-xs">
          <div className="border-r px-2 py-2">
            <p className="text-muted-foreground">Active</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {activeCount}
            </p>
          </div>
          <div className="border-r px-2 py-2">
            <p className="text-muted-foreground">Warranty</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {warrantyCount}
            </p>
          </div>
          <div className="border-r px-2 py-2">
            <p className="text-muted-foreground">Complete</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {completeCount}
            </p>
          </div>
          <div className="px-2 py-2">
            <p className="text-muted-foreground">Other</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {needsStatusCleanupCount}
            </p>
          </div>
        </div>
      </div>

      {canOpenTools && tools.length > 0 && (
        <div className="border-b bg-muted/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Quick tools</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Department scripts and handoff utilities.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {tools.map((tool) => (
                <DepartmentToolButton key={tool.label} tool={tool} />
              ))}
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {tools.map((tool) => (
              <div
                key={`${tool.label}-detail`}
                className="rounded-md border bg-background/75 px-3 py-2"
              >
                <p className="text-sm font-medium">{tool.label}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {tool.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Projects</h3>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-muted-foreground">
              {group.projects.length} shown from {group.allProjects.length} total.
            </p>
            <ProjectSelectionToggle visibleProjectIds={group.projects.map((project) => project.id)} />
          </div>
        </div>
        {group.projects.length > 0 ? (
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            {group.projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-md border border-dashed bg-background/70 p-6 text-center text-sm text-muted-foreground">
            No projects match this department view.
          </div>
        )}
      </div>
    </section>
  )
}
