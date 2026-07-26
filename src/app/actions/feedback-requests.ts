"use server"

import { and, desc, eq, or, sql } from "drizzle-orm"

import { getDb } from "@/db"
import { feedbackDeskItems } from "@/db/schema-jarvis"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"

export type MyFeedbackRequest = {
  readonly id: string
  readonly kind: string
  readonly status: string
  readonly priority: string
  readonly title: string
  readonly description: string
  readonly createdAt: string
  readonly updatedAt: string
}

type MyFeedbackRequestsResult =
  | {
      readonly success: true
      readonly data: readonly MyFeedbackRequest[]
    }
  | { readonly success: false; readonly error: string }

export async function getMyFeedbackRequests(): Promise<MyFeedbackRequestsResult> {
  try {
    const user = await requireAuth()
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const email = user.email.trim().toLowerCase()
    const googleEmail = user.googleEmail?.trim().toLowerCase()
    const reporterMatches =
      googleEmail && googleEmail !== email
        ? or(
            sql`lower(${feedbackDeskItems.reporterEmail}) = ${email}`,
            sql`lower(${feedbackDeskItems.reporterEmail}) = ${googleEmail}`
          )
        : sql`lower(${feedbackDeskItems.reporterEmail}) = ${email}`

    const rows = await db
      .select({
        id: feedbackDeskItems.id,
        kind: feedbackDeskItems.kind,
        status: feedbackDeskItems.status,
        priority: feedbackDeskItems.priority,
        title: feedbackDeskItems.title,
        description: feedbackDeskItems.description,
        createdAt: feedbackDeskItems.createdAt,
        updatedAt: feedbackDeskItems.updatedAt,
      })
      .from(feedbackDeskItems)
      .where(
        and(
          eq(feedbackDeskItems.organizationId, organizationId),
          reporterMatches
        )
      )
      .orderBy(desc(feedbackDeskItems.updatedAt))
      .limit(100)

    return { success: true, data: rows }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load your requests",
    }
  }
}
