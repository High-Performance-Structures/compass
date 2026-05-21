import type * as React from "react"
import Link from "next/link"
import {
  IconAddressBook,
  IconClipboardText,
  IconFileDollar,
  IconFolderSearch,
  IconMailForward,
  IconPhoto,
  IconSearch,
} from "@tabler/icons-react"

import { getProjects } from "@/app/actions/projects"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type ProjectTarget = {
  readonly section: string
  readonly title: string
  readonly description: string
  readonly placeholder: string
  readonly badge: string
  readonly icon: React.ReactElement
}

const TARGETS: readonly ProjectTarget[] = [
  {
    section: "owner-updates",
    title: "Owner Updates",
    description:
      "Choose the project before drafting, reviewing, or publishing an owner update.",
    placeholder: "Search projects for owner updates...",
    badge: "Owner update context",
    icon: <IconMailForward className="size-5 text-muted-foreground" />,
  },
  {
    section: "daily-logs",
    title: "Daily Logs",
    description:
      "Choose the project before reviewing field notes or drafting from logs.",
    placeholder: "Search projects for daily logs...",
    badge: "Daily log context",
    icon: <IconClipboardText className="size-5 text-muted-foreground" />,
  },
  {
    section: "photos",
    title: "Photos",
    description:
      "Choose the project before reviewing visibility, permissions, or galleries.",
    placeholder: "Search projects for photos...",
    badge: "Photo context",
    icon: <IconPhoto className="size-5 text-muted-foreground" />,
  },
  {
    section: "budget",
    title: "Budget / G703",
    description:
      "Choose the project before viewing internal budget detail or owner-safe SOV views.",
    placeholder: "Search projects for budget...",
    badge: "Budget context",
    icon: <IconFileDollar className="size-5 text-muted-foreground" />,
  },
  {
    section: "contacts",
    title: "Project Contacts",
    description:
      "Choose the project before assigning contacts or reviewing portal visibility.",
    placeholder: "Search projects for contacts...",
    badge: "Contact context",
    icon: <IconAddressBook className="size-5 text-muted-foreground" />,
  },
  {
    section: "schedule",
    title: "Project Schedule",
    description:
      "Choose the project before editing tasks, milestones, dependencies, or Gantt views.",
    placeholder: "Search projects for schedule...",
    badge: "Schedule context",
    icon: <IconFolderSearch className="size-5 text-muted-foreground" />,
  },
]

function targetFor(value: string | readonly string[] | undefined): ProjectTarget {
  const target = Array.isArray(value) ? value[0] : value
  return TARGETS.find((item) => item.section === target) ?? TARGETS[0]
}

export default async function ProjectSectionPickerPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly target?: string | readonly string[]
  }>
}): Promise<React.ReactElement> {
  const params = await searchParams
  const target = targetFor(params.target)
  const projects = await getProjects()

  return (
    <div className="flex-1 space-y-6 p-4 pt-6 sm:p-6 md:p-8">
      <div className="max-w-3xl">
        <div className="flex items-center gap-2">
          {target.icon}
          <h1 className="text-2xl font-semibold tracking-tight">
            {target.title}
          </h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {target.description} Compass will not guess a project for this
          workflow.
        </p>
      </div>

      <section className="rounded-xl border bg-muted/30 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Project required first</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This keeps owner updates, logs, photos, budgets, contacts, and
              schedules attached to the intended job.
            </p>
          </div>
          <Badge variant="secondary">{target.badge}</Badge>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Select project</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Search by project number, name, client, or accounting context.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/projects">
              <IconSearch className="size-4" />
              Browse projects
            </Link>
          </Button>
        </div>

        {projects.length > 0 ? (
          <div className="max-w-xl rounded-xl border bg-background p-4 shadow-sm">
            <ProjectQuickSwitcher
              projects={projects}
              targetSection={target.section}
              placeholder={target.placeholder}
              className="w-full"
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Choosing a project opens that project&apos;s {target.title} view.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-background p-8 text-center">
            <IconFolderSearch className="mx-auto size-6 text-muted-foreground" />
            <h2 className="mt-3 text-sm font-semibold">No projects available</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add projects before opening this workflow.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
