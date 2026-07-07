export const dynamic = "force-dynamic"

import {
  IconArrowLeft,
  IconAddressBook,
  IconEye,
  IconUsers,
} from "@tabler/icons-react"
import Link from "next/link"

import {
  getProjectContactsSummary,
  type ProjectContactsSummary,
} from "@/app/actions/project-contacts"
import {
  ProjectContactsDirectory,
  ProjectContactsPanel,
} from "@/components/projects/project-contacts-panel"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { Badge } from "@/components/ui/badge"

export default async function ProjectContactsPage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params

  let contacts: ProjectContactsSummary | null = null

  try {
    contacts = await getProjectContactsSummary(id, "internal")
  } catch (error) {
    console.warn("Project contacts unavailable", error)
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/dashboard/projects/${id}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconArrowLeft className="size-4" />
            Project
          </Link>
          <div className="mt-3 flex items-center gap-2">
            <IconAddressBook className="size-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Project Contacts
            </h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Customers, vendors, and internal team members for this project.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <ProjectContextSwitcher
            currentProjectId={id}
            targetSection="contacts"
            placeholder="Switch contacts project..."
            className="w-full sm:w-[280px]"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant="outline">
              <IconEye className="mr-1 size-3" />
              Portal visibility
            </Badge>
            <Badge variant="secondary">
              <IconUsers className="mr-1 size-3" />
              Source mapping
            </Badge>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <ProjectContactsPanel
          projectId={id}
          summary={contacts}
          showOpenLink={false}
        />
      </div>

      {contacts && (
        <ProjectContactsDirectory projectId={id} summary={contacts} />
      )}
    </div>
  )
}
