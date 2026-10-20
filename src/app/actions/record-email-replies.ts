"use server"

import { and, desc, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { emailReplyThreads, inboundEmails, projects } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { isInternalStaffRole } from "@/lib/user-roles"

export type RecordEmailReplyItem = {
  readonly id: string
  readonly recordId: string
  readonly from: string
  readonly subject: string
  readonly body: string
  readonly receivedAt: string
}

/** Outside email replies to a project's RFQ or purchase order emails. Staff only. */
export async function getProjectRecordEmailReplies(
  projectId: string,
  kind: "rfq" | "purchase_order"
): Promise<readonly RecordEmailReplyItem[]> {
  const user = await requireAuth()
  await requireFeaturePermission(user, kind === "rfq" ? "rfqs" : "purchase-orders", "read")
  if (!isInternalStaffRole(user.role)) return []
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const rows = await db
    .select({
      id: inboundEmails.id,
      recordId: emailReplyThreads.sourceId,
      fromAddress: inboundEmails.fromAddress,
      fromName: inboundEmails.fromName,
      subject: inboundEmails.subject,
      textBody: inboundEmails.textBody,
      snippet: inboundEmails.snippet,
      receivedAt: inboundEmails.receivedAt,
    })
    .from(inboundEmails)
    .innerJoin(emailReplyThreads, eq(emailReplyThreads.id, inboundEmails.replyThreadId))
    .innerJoin(projects, eq(projects.id, inboundEmails.projectId))
    .where(
      and(
        eq(inboundEmails.projectId, projectId),
        eq(projects.organizationId, organizationId),
        eq(inboundEmails.matchedStatus, "posted"),
        eq(emailReplyThreads.sourceType, kind)
      )
    )
    .orderBy(desc(inboundEmails.receivedAt))
    .limit(200)

  return rows.map((row) => ({
    id: row.id,
    recordId: row.recordId,
    from: row.fromName ?? row.fromAddress,
    subject: row.subject,
    body: row.textBody?.trim() || row.snippet?.trim() || "Email reply received.",
    receivedAt: row.receivedAt,
  }))
}
