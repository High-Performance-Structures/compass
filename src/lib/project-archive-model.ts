import { z } from "zod/v4"

import { ARCHIVE_AUDIENCES, ARCHIVE_DOCUMENT_KINDS } from "@/lib/domain/documents/statuses"

export const archivePublicationSchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(ARCHIVE_DOCUMENT_KINDS),
  period: z.string().trim().min(1).max(120),
  audience: z.enum(ARCHIVE_AUDIENCES),
  driveFileId: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/),
  sourceRecordIds: z.array(z.string().trim().min(1).max(200)).min(1).max(5000),
  sourceAudienceEvidence: z.string().trim().min(10).max(2000),
  recipientUserIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  audienceConfirmed: z.literal(true),
})
export type ArchivePublication = z.infer<typeof archivePublicationSchema>
