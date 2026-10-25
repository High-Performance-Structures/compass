import { getAudienceArchives } from "@/app/actions/project-archives"
import { ProjectArchiveLibrary } from "@/components/projects/project-archive-library"
import type { ProjectAudience } from "@/lib/project-audience-access"

export async function ProjectAudienceArchiveSection({ projectId, audience }: { readonly projectId: string; readonly audience: ProjectAudience }): Promise<React.ReactElement> {
  const documents = await getAudienceArchives(projectId, audience)
  return <ProjectArchiveLibrary projectId={projectId} documents={documents} />
}
