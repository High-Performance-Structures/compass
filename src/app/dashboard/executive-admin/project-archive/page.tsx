import { redirect } from "next/navigation"
import { getArchivedRegistryProjects } from "@/app/actions/project-registry-archive"
import { ProjectRegistryArchive } from "@/components/projects/project-registry-archive"
import { getCurrentUser } from "@/lib/auth"
import { canUseExecutiveAdmin } from "@/lib/permissions"

export const dynamic = "force-dynamic"
export default async function ProjectArchivePage(): Promise<React.ReactElement> {
  const user = await getCurrentUser(); if (!canUseExecutiveAdmin(user)) redirect("/dashboard/access-restricted")
  const projects = await getArchivedRegistryProjects()
  return <main className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6"><div><h1 className="text-2xl font-semibold">Project Archive</h1><p className="mt-1 text-sm text-muted-foreground">Recover projects removed from the active registry, or permanently delete empty test records. Removed numbers remain retired.</p></div><ProjectRegistryArchive projects={projects} /></main>
}
