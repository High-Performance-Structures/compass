import { asc, eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { projectRfiAttachments, projectRfis, projects } from "@/db/schema"
import { projectBrandFor } from "@/lib/project-branding"
import { projectNumberAndName } from "@/lib/project-display-name"
import { statusLabel } from "@/lib/project-operations/status"
import type { LoadedPaperTrailRecord } from "@/lib/paper-trail/types"

export async function loadRfiRecord(
  db: ReturnType<typeof getDb>,
  recordId: string,
): Promise<LoadedPaperTrailRecord | null> {
  const [row] = await db
    .select({ rfi: projectRfis, project: { name: projects.name, projectNumber: projects.projectNumber } })
    .from(projectRfis)
    .innerJoin(projects, eq(projects.id, projectRfis.projectId))
    .where(eq(projectRfis.id, recordId))
    .limit(1)
  if (!row) return null
  const { rfi, project } = row
  const attachments = await db
    .select({ fileName: projectRfiAttachments.fileName, url: projectRfiAttachments.storageUrl, updatedAt: projectRfiAttachments.updatedAt })
    .from(projectRfiAttachments)
    .where(eq(projectRfiAttachments.rfiId, recordId))
    .orderBy(asc(projectRfiAttachments.createdAt))

  const brand = projectBrandFor({ projectId: rfi.projectId, projectNumber: project.projectNumber })
  const number = rfi.rfiNumber?.trim() || "Unnumbered"

  return {
    projectId: rfi.projectId,
    version: [rfi.updatedAt, attachments.length, ...attachments.map((item) => item.updatedAt)].join("|"),
    fileBaseName: `RFI ${number} - ${rfi.subject}`,
    sheet: {
      companyName: brand.companyName,
      companyLines: brand.contactLines,
      recordLabel: "Request for Information",
      title: `RFI ${number}`,
      projectLabel: projectNumberAndName(project),
      status: statusLabel(rfi.status),
      sections: [
        {
          kind: "fields",
          heading: "RFI",
          fields: [
            ["Subject", rfi.subject],
            ["Priority", statusLabel(rfi.priority)],
            ["Requested by", rfi.requesterName],
            ["Company", rfi.companyName],
            ["Assigned to", rfi.assignedToName],
            ["Visible to", statusLabel(rfi.audience)],
            ["Submitted", rfi.submittedAt],
            ["Due", rfi.dueDate],
            ["Answered", rfi.answeredAt],
          ],
        },
        { kind: "text", heading: "Question", body: rfi.question },
        { kind: "text", heading: "Answer", body: rfi.answer },
        {
          kind: "table",
          heading: "Attachments",
          columns: [{ label: "File" }, { label: "Location" }],
          rows: attachments.map((item) => [item.fileName, item.url ?? ""]),
        },
      ],
    },
  }
}
