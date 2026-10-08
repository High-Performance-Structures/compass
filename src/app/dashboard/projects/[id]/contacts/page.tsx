export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import {
  IconAddressBook,
  IconEye,
  IconUsers,
} from "@tabler/icons-react"

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
import { PageHeader } from "@/components/page-header"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { Badge } from "@/components/ui/badge"
import { DeveloperOnly } from "@/components/developer-mode-provider"
import { projectNumberAndName } from "@/lib/project-display-name"

export default async function ProjectContactsPage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)

  let contacts: ProjectContactsSummary | null = null
  let directoryOptions: readonly ProjectContactDirectoryOption[] = []
  let sageOptions: ProjectContactSageOptions = { divisions: [], costCodes: [] }
  let canManageContacts = false
  let projectLabel = "This project"

  try {
    const [contactSummary, projectList] = await Promise.all([
      getProjectContactsSummary(id, "internal", { includeHistorical: true }),
      getProjects(),
    ])
    contacts = contactSummary
    const project = projectList.find((item) => item.id === id)
    if (project) {
      projectLabel = project.projectNumber
        ? projectNumberAndName(project, " - ")
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
      <PageHeader
        back={{ href: `/dashboard/projects/${id}`, label: "Project" }}
        icon={<IconAddressBook className="size-5 text-primary" />}
        title="Project Contacts"
        description={
          <>
            Customers, vendors, and internal team members for this project.
          </>
        }
        actions={
          <>
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
          </>
        }
      />

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
