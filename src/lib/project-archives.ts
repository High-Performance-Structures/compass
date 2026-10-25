import { and, asc, eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { organizationMembers, organizations, projectMembers, projects, users } from "@/db/schema"
import { projectArchiveDocuments, projectArchiveRecipients, type ProjectArchiveDocument } from "@/db/schema-project-archives"
import { canUseProjectAudience, type ProjectAudience } from "@/lib/project-audience-access"
import { isInternalStaffRole } from "@/lib/user-roles"

import { archivePublicationSchema, type ArchivePublication } from "@/lib/project-archive-model"
export type { ArchivePublication } from "@/lib/project-archive-model"
export { archivePublicationSchema } from "@/lib/project-archive-model"
type Db = ReturnType<typeof getDb>
export type ArchiveReader = { readonly id: string; readonly name: string; readonly email: string; readonly audience: ProjectAudience }
export type ArchiveSummary = Pick<ProjectArchiveDocument, "id" | "title" | "kind" | "period" | "pageCount" | "byteSize" | "status" | "publishedAt"> & { readonly sourceCount: number }
export type ArchiveScope = { readonly projectId: string; readonly organizationId: string; readonly audience: ProjectAudience; readonly viewerId: string | null }

/** Real active accounts only. Pending invitations and display/company labels grant nothing. */
export async function archiveReaders(db: Db, projectId: string, organizationId: string): Promise<readonly ArchiveReader[]> {
  const rows = await db.select({ id: users.id, name: users.displayName, email: users.email, role: organizationMembers.role, projectRole: projectMembers.role })
    .from(projectMembers).innerJoin(users, and(eq(users.id, projectMembers.userId), eq(users.isActive, true)))
    .innerJoin(projects, and(eq(projects.id, projectMembers.projectId), eq(projects.organizationId, organizationId)))
    .innerJoin(organizations, and(eq(organizations.id, projects.organizationId), eq(organizations.isActive, true)))
    .innerJoin(organizationMembers, and(eq(organizationMembers.organizationId, organizations.id), eq(organizationMembers.userId, users.id)))
    .where(eq(projectMembers.projectId, projectId))
  const readers: ArchiveReader[] = []
  for (const row of rows) {
    if (isInternalStaffRole(row.role) || !["client", "subcontractor", "supplier", "guest"].includes(row.role)) continue
    const audience = canUseProjectAudience(row.projectRole, "owner") ? "owner" : canUseProjectAudience(row.projectRole, "sub_vendor") ? "sub_vendor" : null
    if (audience && !readers.some((reader) => reader.id === row.id && reader.audience === audience)) readers.push({ id: row.id, name: row.name ?? row.email, email: row.email, audience })
  }
  return readers
}

export function archiveSummary(row: ProjectArchiveDocument): ArchiveSummary {
  const ids: unknown = JSON.parse(row.sourceRecordIds)
  return { id: row.id, title: row.title, kind: row.kind, period: row.period, pageCount: row.pageCount, byteSize: row.byteSize, status: row.status, publishedAt: row.publishedAt, sourceCount: Array.isArray(ids) ? ids.length : 0 }
}

/** The same named-account rule is used by the list and by every byte download. */
export async function visibleArchiveRecords(db: Db, scope: ArchiveScope): Promise<readonly ProjectArchiveDocument[]> {
  if (!scope.viewerId) return []
  const readers = await archiveReaders(db, scope.projectId, scope.organizationId)
  if (!readers.some((reader) => reader.id === scope.viewerId && reader.audience === scope.audience)) return []
  const rows = await db.select({ document: projectArchiveDocuments }).from(projectArchiveDocuments)
    .innerJoin(projectArchiveRecipients, and(eq(projectArchiveRecipients.archiveId, projectArchiveDocuments.id), eq(projectArchiveRecipients.userId, scope.viewerId)))
    .where(and(eq(projectArchiveDocuments.projectId, scope.projectId), eq(projectArchiveDocuments.organizationId, scope.organizationId), eq(projectArchiveDocuments.audience, scope.audience), eq(projectArchiveDocuments.status, "published")))
    .orderBy(asc(projectArchiveDocuments.period), asc(projectArchiveDocuments.publishedAt))
  return rows.map((row) => row.document)
}

export async function publishArchiveRecord(input: {
  readonly db: Db; readonly projectId: string; readonly organizationId: string; readonly actorId: string
  readonly publication: ArchivePublication
  readonly fingerprint: { readonly fileName: string; readonly sha256: string; readonly byteSize: number; readonly pageCount: number }
}): Promise<string> {
  const parsed = archivePublicationSchema.parse(input.publication)
  const readerIds = [...new Set(parsed.recipientUserIds)]
  const eligible = await archiveReaders(input.db, input.projectId, input.organizationId)
  if (readerIds.some((id) => !eligible.some((reader) => reader.id === id && reader.audience === parsed.audience))) throw new Error("Every recipient must have matching active project access.")
  const id = crypto.randomUUID()
  // One batch: a failed/revoked recipient cannot leave a partially published edition.
  await input.db.batch([
    input.db.insert(projectArchiveDocuments).values({ id, organizationId: input.organizationId, projectId: input.projectId, title: parsed.title, kind: parsed.kind, period: parsed.period, audience: parsed.audience, sourceRecordIds: JSON.stringify([...new Set(parsed.sourceRecordIds)]), sourceAudienceEvidence: parsed.sourceAudienceEvidence, driveFileId: parsed.driveFileId, ...input.fingerprint, publishedBy: input.actorId, publishedAt: new Date().toISOString() }),
    ...readerIds.map((userId) => input.db.insert(projectArchiveRecipients).values({ archiveId: id, userId })),
  ])
  return id
}
