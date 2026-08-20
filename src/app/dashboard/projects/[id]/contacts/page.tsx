export const dynamic = "force-dynamic"

import {
  IconArrowLeft,
  IconAddressBook,
  IconEye,
  IconUsers,
} from "@tabler/icons-react"
import Link from "next/link"

import {
  getProjectContactDirectoryOptions,
  getProjectContactSageOptions,
  getProjectContactsSummary,
  type ProjectContactDirectoryOption,
  type ProjectContactSageOptions,
  type ProjectContactsSummary,
} from "@/app/actions/project-contacts"
import { getProjects } from "@/app/actions/projects"
import {
  ProjectContactsDirectory,
  ProjectContactsPanel,
} from "@/components/projects/project-contacts-panel"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { Badge } from "@/components/ui/badge"
import { DeveloperOnly } from "@/components/developer-mode-provider"

export default async function ProjectContactsPage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params

  let contacts: ProjectContactsSummary | null = null
  let directoryOptions: readonly ProjectContactDirectoryOption[] = []
  let sageOptions: ProjectContactSageOptions = { divisions: [], costCodes: [] }
  let canManageContacts = false
  let projectLabel = "This project"

  try {
    const [contactSummary, projectList] = await Promise.all([
      getProjectContactsSummary(id, "internal"),
      getProjects(),
    ])
    contacts = contactSummary
    const project = projectList.find((item) => item.id === id)
    if (project) {
      projectLabel = project.projectNumber
        ? `${project.projectNumber} - ${project.name}`
        : project.name
    }
  } catch (error) {
    console.warn("Project contacts unavailable", error)
  }

  try {
    const [loadedDirectoryOptions, loadedSageOptions] = await Promise.all([
      getProjectContactDirectoryOptions(id),
      getProjectContactSageOptions(id),
    ])
    directoryOptions = loadedDirectoryOptions
    sageOptions = loadedSageOptions
    canManageContacts = true
  } catch {
    // Read-only project users may view allowed contacts without receiving the
    // organization-wide directory or any editing controls.
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
            <DeveloperOnly>
              <Badge variant="secondary">
                <IconUsers className="mr-1 size-3" />
                Source mapping
              </Badge>
            </DeveloperOnly>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <ProjectContactsPanel
          projectId={id}
          projectLabel={projectLabel}
          summary={contacts}
          showOpenLink={false}
          directoryOptions={canManageContacts ? directoryOptions : undefined}
          sageOptions={canManageContacts ? sageOptions : undefined}
        />
      </div>

      {contacts && (
        <ProjectContactsDirectory
          projectId={id}
          projectLabel={projectLabel}
          summary={contacts}
          directoryOptions={canManageContacts ? directoryOptions : undefined}
          sageOptions={canManageContacts ? sageOptions : undefined}
        />
      )}
    </div>
  )
}
