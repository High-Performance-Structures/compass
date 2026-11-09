"use client"

// One project's card on the Projects page: number, name, statuses, and quick
// links to its schedule, contacts, budget and Drive folder.

import * as React from "react"
import Link from "next/link"
import {
  IconAddressBook,
  IconBrandGoogleDrive,
  IconCalendarStats,
  IconFileDollar,
} from "@tabler/icons-react"
import type { ProjectsHubProject } from "@/app/dashboard/projects/page"
import { cn } from "@/lib/utils"
import { projectClientStatusLabel } from "@/lib/project-profile"
import {
  ProjectSelectCheckbox,
  useProjectSelected,
} from "@/components/projects/project-bulk-selection"
import {
  departmentIdForProject,
  projectLabel,
  projectSubtitle,
  googleDriveUrl,
  departmentBorderClassName,
} from "./projects-hub-model"

export function ProjectCard({
  project,
}: {
  readonly project: ProjectsHubProject
}): React.ReactElement {
  const label = projectLabel(project)
  const subtitle = projectSubtitle(project)
  const departmentId = departmentIdForProject(project)
  const selected = useProjectSelected(project.id)
  const actionClassName =
    "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"

  return (
    <article
      className={cn(
        "group rounded-md border border-l-[6px] bg-card px-3 py-2.5 shadow-sm transition-colors hover:bg-muted/55",
        departmentBorderClassName(departmentId),
        selected && "ring-2 ring-primary/60"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-2">
        <ProjectSelectCheckbox projectId={project.id} label={label} />
        <div className="min-w-0">
          <Link
            href={`/dashboard/projects/${project.id}`}
            className="line-clamp-1 text-sm font-semibold text-foreground underline-offset-4 hover:underline"
          >
            {label}
          </Link>
          {subtitle && (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {project.jobStatusLabel}
          </span>
          <span className="rounded-md border px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {projectClientStatusLabel(project.clientStatus)}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t pt-2">
        <Link
          href={`/dashboard/projects/${project.id}/schedule`}
          className={actionClassName}
        >
          <IconCalendarStats className="size-3.5" />
          Schedule
        </Link>
        <Link
          href={`/dashboard/projects/${project.id}/contacts`}
          className={actionClassName}
        >
          <IconAddressBook className="size-3.5" />
          Contacts
        </Link>
        <Link
          href={`/dashboard/projects/${project.id}/budget`}
          className={actionClassName}
        >
          <IconFileDollar className="size-3.5" />
          Budget
        </Link>
        {project.googleDriveFolderId && (
          <a
            href={googleDriveUrl(project.googleDriveFolderId)}
            target="_blank"
            rel="noreferrer"
            className={actionClassName}
          >
            <IconBrandGoogleDrive className="size-3.5" />
            Drive
          </a>
        )}
      </div>
    </article>
  )
}
