import { getArchivedRegistryProjects } from "@/app/actions/project-registry-archive"
import { ProjectRegistryArchive } from "@/components/projects/project-registry-archive"
import { getCurrentUser } from "@/lib/auth"
import { canFeature } from "@/lib/permission-enforcement"
import { PageHeader } from "@/components/page-header"
import { ClientRedirect } from "@/components/client-redirect"

export const dynamic = "force-dynamic"
export default async function ProjectArchivePage(): Promise<React.ReactElement> {
  const user = await getCurrentUser(); if (!(await canFeature(user, "project-archive-access", "read"))) return <ClientRedirect href={"/dashboard/access-restricted"} />
  const projects = await getArchivedRegistryProjects()
  return <main className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6"><PageHeader className="mb-0" title="Project Archive" /><ProjectRegistryArchive projects={projects} /></main>
}
