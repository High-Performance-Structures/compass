import { getActiveFieldProjects, getFieldProjectPacket } from "@/app/actions/field-mode"
import { FieldModeWorkspace } from "@/components/field/field-mode-workspace"
import { requireAuth } from "@/lib/auth"

export default async function FieldModePage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly projectId?: string
    readonly view?: string
    readonly downloadFileId?: string
    readonly folderId?: string
  }>
}): Promise<React.ReactElement> {
  const [user, projects] = await Promise.all([
    requireAuth(),
    getActiveFieldProjects(),
  ])
  const { projectId, view, downloadFileId, folderId } = await searchParams
  const selectedProject =
    projects.find((project) => project.id === projectId) ?? projects[0] ?? null
  const initialPacket = selectedProject
    ? await getFieldProjectPacket(selectedProject.id)
    : null

  return (
    <FieldModeWorkspace
      userId={user.id}
      profile={{
        name: user.displayName ?? user.email.split("@")[0] ?? "Compass user",
        email: user.email,
        role: user.role,
      }}
      projects={projects}
      initialPacket={initialPacket}
      initialTab={view === "documents" ? "documents" : "today"}
      initialDownloadFileId={downloadFileId ?? null}
      initialFolderId={folderId ?? null}
      restoreStoredProject={!projectId}
    />
  )
}
