"use server"

import { and, desc, eq, lt, or, sql } from "drizzle-orm"
import {
  correspondence,
  correspondenceMessages,
} from "@/db/schema-correspondence"
import { correspondenceSourceMessages } from "@/db/schema-correspondence-source"
import { correspondenceContext } from "@/lib/correspondence/access"
import { readCorrespondence } from "@/lib/correspondence/read"
import type {
  CorrespondenceDetail,
  CorrespondenceResult,
  ProjectMessageHistoryPage,
} from "@/lib/correspondence/types"

export async function getProjectMessageHistory(
  projectId: string,
  query = "",
  cursor?: { readonly sentAt: string; readonly conversationId: string },
): Promise<CorrespondenceResult<ProjectMessageHistoryPage>> {
  try {
    const ctx = await correspondenceContext(projectId)
    if (ctx.workspace !== "staff")
      throw new Error("Project history is unavailable.")
    if (
      typeof query !== "string" ||
      query.length > 500 ||
      (cursor &&
        (typeof cursor.sentAt !== "string" ||
          typeof cursor.conversationId !== "string"))
    )
      throw new Error("Invalid search.")
    const pattern = `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`
    // Select each conversation's latest sent message before paging, independent of personal archive/read state.
    const rows = await ctx.db
      .select({
        id: correspondence.id,
        subject: correspondence.subject,
        authorName: correspondenceMessages.authorName,
        body: correspondenceMessages.body,
        retractedAt: correspondenceMessages.retractedAt,
        sentAt: correspondenceMessages.sentAt,
        sourceSentDisplay: correspondenceSourceMessages.sourceSentDisplay,
        sourceSentAt: correspondenceSourceMessages.sourceSentAt,
      })
      .from(correspondence)
      .innerJoin(
        correspondenceMessages,
        and(
          eq(correspondenceMessages.conversationId, correspondence.id),
          sql`${correspondenceMessages.sequence}=(SELECT m.sequence FROM correspondence_messages m WHERE m.conversation_id=${correspondence.id} ORDER BY m.sent_at DESC, m.sequence DESC LIMIT 1)`,
        ),
      )
      .leftJoin(
        correspondenceSourceMessages,
        and(
          eq(correspondenceSourceMessages.messageId, correspondenceMessages.id),
          eq(correspondenceSourceMessages.projectId, ctx.projectId),
          eq(correspondenceSourceMessages.organizationId, ctx.organizationId),
        ),
      )
      .where(
        and(
          eq(correspondence.projectId, ctx.projectId),
          eq(correspondence.organizationId, ctx.organizationId),
          query.trim()
            ? or(
                sql`${correspondence.subject} LIKE ${pattern} ESCAPE '\\'`,
                sql`EXISTS (SELECT 1 FROM correspondence_messages m WHERE m.conversation_id=${correspondence.id} AND m.retracted_at IS NULL AND (m.body LIKE ${pattern} ESCAPE '\\' OR m.author_name LIKE ${pattern} ESCAPE '\\'))`,
              )
            : undefined,
          cursor
            ? or(
                lt(correspondenceMessages.sentAt, cursor.sentAt),
                and(
                  eq(correspondenceMessages.sentAt, cursor.sentAt),
                  lt(correspondence.id, cursor.conversationId),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(correspondenceMessages.sentAt), desc(correspondence.id))
      .limit(51)
    const visible = rows.slice(0, 50)
    const last = visible.at(-1)
    return {
      success: true,
      data: {
        projectName: ctx.projectName,
        viewerId: ctx.user.id,
        conversations: visible.map(({ body, retractedAt, ...row }) => ({
          ...row,
          excerpt: retractedAt ? "Message retracted" : body.slice(0, 180),
        })),
        nextCursor:
          rows.length > 50 && last
            ? { sentAt: last.sentAt, conversationId: last.id }
            : null,
      },
    }
  } catch {
    return {
      success: false,
      error: "Project message history is unavailable. Refresh and try again.",
    }
  }
}

export async function getProjectMessageHistoryDetail(
  projectId: string,
  conversationId: string,
  beforeSequence?: number,
): Promise<CorrespondenceResult<CorrespondenceDetail>> {
  try {
    const ctx = await correspondenceContext(projectId)
    if (ctx.workspace !== "staff")
      throw new Error("Project history is unavailable.")
    return {
      success: true,
      data: await readCorrespondence(ctx, conversationId, beforeSequence, true),
    }
  } catch {
    return {
      success: false,
      error: "This project conversation is unavailable. Refresh and try again.",
    }
  }
}
