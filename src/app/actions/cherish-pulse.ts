"use server"

import { and, desc, eq, or, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  cherishPulseResponses,
  organizationMembers,
  users,
} from "@/db/schema"
import { getCloudflareContext } from "@/lib/db"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"
import { canUseExecutiveAdmin, canUseFieldDesk } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

export type CherishValue =
  | "Camaraderie"
  | "Honor"
  | "Excellence"
  | "Reliability"
  | "Integrity"
  | "Servitude"
  | "Humility"

export type CherishPulseResponseType = "shoutout" | "concern" | "win"
export type CherishPulseVisibility = "team" | "private"
export type CherishPulseSource =
  | "compass_dashboard"
  | "compass_mobile"
  | "telegram"
  | "exaktime"
  | "admin_entry"
export type CherishPulseReviewStatus =
  | "needs_review"
  | "approved"
  | "archived"
export type CherishPulseReviewDecision = "approve" | "archive"
export type CherishPulseAudience =
  | { readonly scope: "company" }
  | { readonly scope: "user"; readonly recipientId: string }

export type CherishPulseReviewItem = {
  readonly id: string
  readonly cherishValue: CherishValue
  readonly responseType: CherishPulseResponseType
  readonly message: string
  readonly source: CherishPulseSource
  readonly visibility: CherishPulseVisibility
  readonly reviewStatus: CherishPulseReviewStatus
  readonly isAnonymous: boolean
  readonly submittedByName: string | null
  readonly submittedByEmail: string | null
  readonly weekStart: string
  readonly createdAt: string
  readonly audience: CherishPulseAudience
}

export type SubmitCherishPulseInput = {
  readonly cherishValue: CherishValue
  readonly responseType: CherishPulseResponseType
  readonly message: string
  readonly source?: CherishPulseSource
  readonly clientSubmissionId?: string
  readonly anonymous?: boolean
  readonly recipientId?: string
}

export type SearchCherishPulseArchiveInput = {
  readonly query?: string
}

export type ReviewCherishPulseInput = {
  readonly id: string
  readonly decision: CherishPulseReviewDecision
}

type ActionResult<T> =
  | {
      readonly success: true
      readonly data: T
    }
  | {
      readonly success: false
      readonly error: string
    }

export async function submitCherishPulseResponse(
  input: SubmitCherishPulseInput
): Promise<ActionResult<CherishPulseReviewItem>> {
  try {
    const user = await requireAuth()
    if (!canSubmitCherishPulse(user)) {
      return {
        success: false,
        error: "Only internal team members can submit CHERISH Pulse responses.",
      }
    }

    const organizationId = requireOrg(user)
    const message = input.message.trim()
    if (message.length < 3) {
      return {
        success: false,
        error: "Add a little more detail before submitting.",
      }
    }

    if (message.length > 1200) {
      return {
        success: false,
        error: "Keep Pulse responses under 1,200 characters.",
      }
    }

    if (!isCherishValue(input.cherishValue)) {
      return {
        success: false,
        error: "Choose a valid CHERISH value.",
      }
    }

    if (!isCherishResponseType(input.responseType)) {
      return {
        success: false,
        error: "Choose a valid response type.",
      }
    }

    const source = input.source ?? "compass_dashboard"
    if (!isCherishPulseSource(source)) {
      return {
        success: false,
        error: "Choose a valid response source.",
      }
    }

    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return {
        success: false,
        error: "Compass storage is not available right now.",
      }
    }

    const clientSubmissionId = input.clientSubmissionId?.trim()
    if (
      clientSubmissionId !== undefined &&
      !isValidClientSubmissionId(clientSubmissionId)
    ) {
      return {
        success: false,
        error: "The offline submission identifier is invalid.",
      }
    }

    const db = getDb(env.DB)
    if (clientSubmissionId) {
      const existing = await db
        .select({
          id: cherishPulseResponses.id,
          cherishValue: cherishPulseResponses.cherishValue,
          responseType: cherishPulseResponses.responseType,
          message: cherishPulseResponses.message,
          source: cherishPulseResponses.source,
          visibility: cherishPulseResponses.visibility,
          reviewStatus: cherishPulseResponses.reviewStatus,
          isAnonymous: cherishPulseResponses.isAnonymous,
          submittedByName: cherishPulseResponses.submittedByName,
          submittedByEmail: cherishPulseResponses.submittedByEmail,
          weekStart: cherishPulseResponses.weekStart,
          createdAt: cherishPulseResponses.createdAt,
          audienceScope: cherishPulseResponses.audienceScope,
          audienceReferenceId: cherishPulseResponses.audienceReferenceId,
        })
        .from(cherishPulseResponses)
        .where(
          and(
            eq(cherishPulseResponses.id, clientSubmissionId),
            eq(cherishPulseResponses.organizationId, organizationId),
            eq(cherishPulseResponses.submittedBy, user.id)
          )
        )
        .limit(1)

      const existingItem = existing[0]
      if (existingItem) {
        return {
          success: true,
          data: rowToReviewItem(existingItem),
        }
      }
    }

    const now = new Date().toISOString()
    const visibility = visibilityForType(input.responseType)
    const isAnonymous = input.anonymous === true
    const submittedByName = nameForUser(user)
    const audienceResult = await resolveSubmissionAudience({
      db,
      organizationId,
      submitterId: user.id,
      responseType: input.responseType,
      recipientId: input.recipientId,
    })
    if (!audienceResult.success) return audienceResult

    const item: CherishPulseReviewItem = {
      id: clientSubmissionId ?? crypto.randomUUID(),
      cherishValue: input.cherishValue,
      responseType: input.responseType,
      message,
      source,
      visibility,
      reviewStatus: "needs_review",
      isAnonymous,
      submittedByName: isAnonymous ? null : submittedByName,
      submittedByEmail: isAnonymous ? null : user.email,
      weekStart: weekStartForDate(new Date()),
      createdAt: now,
      audience: audienceResult.data,
    }

    await db
      .insert(cherishPulseResponses)
      .values({
        id: item.id,
        organizationId,
        submittedBy: user.id,
        // Keep ownership for audit/recovery while masking it from every
        // user-facing query when the submitter asks to be anonymous.
        submittedByName,
        submittedByEmail: user.email,
        isAnonymous,
        weekStart: item.weekStart,
        cherishValue: item.cherishValue,
        responseType: item.responseType,
        message: item.message,
        source: item.source,
        visibility: item.visibility,
        audienceScope: item.audience.scope,
        audienceReferenceId:
          item.audience.scope === "user" ? item.audience.recipientId : null,
        reviewStatus: item.reviewStatus,
        reviewedBy: null,
        reviewedAt: null,
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    return {
      success: true,
      data: item,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to save the Pulse response.",
    }
  }
}

export async function getCherishPulseReviewQueue(): Promise<
  ActionResult<readonly CherishPulseReviewItem[]>
> {
  try {
    const user = await requireAuth()
    if (!canUseExecutiveAdmin(user)) {
      return {
        success: false,
        error: "Executive Admin access is required to review CHERISH responses.",
      }
    }

    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return {
        success: false,
        error: "Compass storage is not available right now.",
      }
    }

    const db = getDb(env.DB)
    const rows = await db
      .select({
        id: cherishPulseResponses.id,
        cherishValue: cherishPulseResponses.cherishValue,
        responseType: cherishPulseResponses.responseType,
        message: cherishPulseResponses.message,
        source: cherishPulseResponses.source,
        visibility: cherishPulseResponses.visibility,
        reviewStatus: cherishPulseResponses.reviewStatus,
        isAnonymous: cherishPulseResponses.isAnonymous,
        submittedByName: cherishPulseResponses.submittedByName,
        submittedByEmail: cherishPulseResponses.submittedByEmail,
        weekStart: cherishPulseResponses.weekStart,
        createdAt: cherishPulseResponses.createdAt,
        audienceScope: cherishPulseResponses.audienceScope,
        audienceReferenceId: cherishPulseResponses.audienceReferenceId,
      })
      .from(cherishPulseResponses)
      .where(
        and(
          eq(cherishPulseResponses.organizationId, organizationId),
          eq(cherishPulseResponses.reviewStatus, "needs_review")
        )
      )
      .orderBy(desc(cherishPulseResponses.createdAt))
      .limit(20)

    return {
      success: true,
      data: rows.map(rowToReviewItem),
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to load the Pulse review queue.",
    }
  }
}

export async function getCherishPulseTeamStream(): Promise<
  ActionResult<readonly CherishPulseReviewItem[]>
> {
  try {
    const user = await requireAuth()
    if (!canViewCherishPulse(user)) {
      return {
        success: false,
        error: "Only internal team members can view CHERISH recognition.",
      }
    }

    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return {
        success: false,
        error: "Compass storage is not available right now.",
      }
    }

    const db = getDb(env.DB)
    const rows = await db
      .select({
        id: cherishPulseResponses.id,
        cherishValue: cherishPulseResponses.cherishValue,
        responseType: cherishPulseResponses.responseType,
        message: cherishPulseResponses.message,
        source: cherishPulseResponses.source,
        visibility: cherishPulseResponses.visibility,
        reviewStatus: cherishPulseResponses.reviewStatus,
        isAnonymous: cherishPulseResponses.isAnonymous,
        submittedByName: cherishPulseResponses.submittedByName,
        submittedByEmail: cherishPulseResponses.submittedByEmail,
        weekStart: cherishPulseResponses.weekStart,
        createdAt: cherishPulseResponses.createdAt,
        audienceScope: cherishPulseResponses.audienceScope,
        audienceReferenceId: cherishPulseResponses.audienceReferenceId,
      })
      .from(cherishPulseResponses)
      .where(
        and(
          eq(cherishPulseResponses.organizationId, organizationId),
          eq(cherishPulseResponses.visibility, "team"),
          or(
            eq(cherishPulseResponses.audienceScope, "company"),
            and(
              eq(cherishPulseResponses.audienceScope, "user"),
              eq(cherishPulseResponses.audienceReferenceId, user.id),
            ),
          ),
          eq(cherishPulseResponses.reviewStatus, "approved")
        )
      )
      .orderBy(
        desc(cherishPulseResponses.publishedAt),
        desc(cherishPulseResponses.createdAt)
      )
      .limit(20)

    return {
      success: true,
      data: rows.map(rowToReviewItem),
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to load CHERISH recognition.",
    }
  }
}

export async function getCherishPulseLeadershipStream(): Promise<
  ActionResult<readonly CherishPulseReviewItem[]>
> {
  try {
    const user = await requireAuth()
    if (!canUseExecutiveAdmin(user)) {
      return {
        success: false,
        error: "Executive Admin access is required to view private CHERISH concerns.",
      }
    }

    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return {
        success: false,
        error: "Compass storage is not available right now.",
      }
    }

    const db = getDb(env.DB)
    const rows = await db
      .select({
        id: cherishPulseResponses.id,
        cherishValue: cherishPulseResponses.cherishValue,
        responseType: cherishPulseResponses.responseType,
        message: cherishPulseResponses.message,
        source: cherishPulseResponses.source,
        visibility: cherishPulseResponses.visibility,
        reviewStatus: cherishPulseResponses.reviewStatus,
        isAnonymous: cherishPulseResponses.isAnonymous,
        submittedByName: cherishPulseResponses.submittedByName,
        submittedByEmail: cherishPulseResponses.submittedByEmail,
        weekStart: cherishPulseResponses.weekStart,
        createdAt: cherishPulseResponses.createdAt,
        audienceScope: cherishPulseResponses.audienceScope,
        audienceReferenceId: cherishPulseResponses.audienceReferenceId,
      })
      .from(cherishPulseResponses)
      .where(
        and(
          eq(cherishPulseResponses.organizationId, organizationId),
          eq(cherishPulseResponses.visibility, "private"),
          eq(cherishPulseResponses.reviewStatus, "approved")
        )
      )
      .orderBy(
        desc(cherishPulseResponses.reviewedAt),
        desc(cherishPulseResponses.createdAt)
      )
      .limit(20)

    return {
      success: true,
      data: rows.map(rowToReviewItem),
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to load private CHERISH concerns.",
    }
  }
}

export async function searchCherishPulseArchive(
  input: SearchCherishPulseArchiveInput = {},
): Promise<ActionResult<readonly CherishPulseReviewItem[]>> {
  try {
    const user = await requireAuth()
    if (!canUseExecutiveAdmin(user)) {
      return {
        success: false,
        error: "Executive Admin access is required to search CHERISH archives.",
      }
    }

    const query = input.query?.trim().toLocaleLowerCase() ?? ""
    if (query.length > 100) {
      return {
        success: false,
        error: "Keep archive searches under 100 characters.",
      }
    }

    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return {
        success: false,
        error: "Compass storage is not available right now.",
      }
    }

    const archiveSearch = query.length > 0
      ? or(
          sql`instr(lower(${cherishPulseResponses.message}), ${query}) > 0`,
          sql`instr(lower(${cherishPulseResponses.cherishValue}), ${query}) > 0`,
          sql`instr(lower(${cherishPulseResponses.responseType}), ${query}) > 0`,
          sql`instr(
            CASE ${cherishPulseResponses.responseType}
              WHEN 'shoutout' THEN 'team shoutout'
              WHEN 'win' THEN 'project win'
              WHEN 'concern' THEN 'private concern'
              ELSE ''
            END,
            ${query}
          ) > 0`,
          sql`instr(lower(${cherishPulseResponses.source}), ${query}) > 0`,
          and(
            eq(cherishPulseResponses.isAnonymous, false),
            or(
              sql`instr(lower(coalesce(${cherishPulseResponses.submittedByName}, '')), ${query}) > 0`,
              sql`instr(lower(coalesce(${cherishPulseResponses.submittedByEmail}, '')), ${query}) > 0`,
            ),
          ),
        )
      : undefined

    const db = getDb(env.DB)
    const rows = await db
      .select({
        id: cherishPulseResponses.id,
        cherishValue: cherishPulseResponses.cherishValue,
        responseType: cherishPulseResponses.responseType,
        message: cherishPulseResponses.message,
        source: cherishPulseResponses.source,
        visibility: cherishPulseResponses.visibility,
        reviewStatus: cherishPulseResponses.reviewStatus,
        isAnonymous: cherishPulseResponses.isAnonymous,
        submittedByName: cherishPulseResponses.submittedByName,
        submittedByEmail: cherishPulseResponses.submittedByEmail,
        weekStart: cherishPulseResponses.weekStart,
        createdAt: cherishPulseResponses.createdAt,
        audienceScope: cherishPulseResponses.audienceScope,
        audienceReferenceId: cherishPulseResponses.audienceReferenceId,
      })
      .from(cherishPulseResponses)
      .where(
        and(
          eq(cherishPulseResponses.organizationId, organizationId),
          eq(cherishPulseResponses.reviewStatus, "archived"),
          archiveSearch,
        ),
      )
      .orderBy(
        desc(cherishPulseResponses.reviewedAt),
        desc(cherishPulseResponses.createdAt),
      )
      .limit(100)

    return {
      success: true,
      data: rows.map(rowToReviewItem),
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to search the CHERISH archive.",
    }
  }
}

export async function reviewCherishPulseResponse(
  input: ReviewCherishPulseInput
): Promise<ActionResult<{ readonly id: string; readonly reviewStatus: CherishPulseReviewStatus }>> {
  try {
    const user = await requireAuth()
    if (!canUseExecutiveAdmin(user)) {
      return {
        success: false,
        error: "Executive Admin access is required to review CHERISH responses.",
      }
    }

    const id = input.id.trim()
    if (id.length === 0) {
      return {
        success: false,
        error: "Choose a Pulse response to review.",
      }
    }

    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return {
        success: false,
        error: "Compass storage is not available right now.",
      }
    }

    const reviewStatus = statusForDecision(input.decision)
    const now = new Date().toISOString()
    const db = getDb(env.DB)
    const existing = await db
      .select({
        id: cherishPulseResponses.id,
        responseType: cherishPulseResponses.responseType,
        audienceScope: cherishPulseResponses.audienceScope,
        audienceReferenceId: cherishPulseResponses.audienceReferenceId,
      })
      .from(cherishPulseResponses)
      .where(
        and(
          eq(cherishPulseResponses.id, id),
          eq(cherishPulseResponses.organizationId, organizationId)
        )
      )
      .get()

    if (!existing) {
      return {
        success: false,
        error: "That Pulse response was not found.",
      }
    }

    if (
      reviewStatus === "approved" &&
      existing.audienceScope === "user"
    ) {
      if (
        existing.responseType !== "shoutout" ||
        existing.audienceReferenceId === null
      ) {
        return {
          success: false,
          error: "This employee-only CHERISH has an invalid recipient.",
        }
      }

      const recipient = await findEligibleRecipient(
        db,
        organizationId,
        existing.audienceReferenceId,
      )
      if (!recipient) {
        return {
          success: false,
          error: "That employee is no longer available as a CHERISH recipient.",
        }
      }
    }

    await db
      .update(cherishPulseResponses)
      .set({
        reviewStatus,
        reviewedBy: user.id,
        reviewedAt: now,
        publishedAt: reviewStatus === "approved" ? now : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(cherishPulseResponses.id, id),
          eq(cherishPulseResponses.organizationId, organizationId)
        )
      )
      .run()

    revalidatePath("/dashboard")
    revalidatePath("/dashboard/cherish")
    revalidatePath("/dashboard/field")
    revalidatePath("/dashboard/executive-admin/cherish")

    return {
      success: true,
      data: {
        id,
        reviewStatus,
      },
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to update the Pulse response.",
    }
  }
}

async function resolveSubmissionAudience(input: {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly submitterId: string
  readonly responseType: CherishPulseResponseType
  readonly recipientId: string | undefined
}): Promise<ActionResult<CherishPulseAudience>> {
  const recipientId = input.recipientId?.trim()
  if (!recipientId) return { success: true, data: { scope: "company" } }

  if (input.responseType !== "shoutout") {
    return {
      success: false,
      error: "Employee recipients are available only for shout-outs.",
    }
  }
  if (recipientId === input.submitterId) {
    return {
      success: false,
      error: "Choose another employee for this shout-out.",
    }
  }

  const recipient = await findEligibleRecipient(
    input.db,
    input.organizationId,
    recipientId,
  )
  if (!recipient) {
    return {
      success: false,
      error: "Choose an active employee from your company.",
    }
  }

  return {
    success: true,
    data: { scope: "user", recipientId: recipient.id },
  }
}

async function findEligibleRecipient(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  recipientId: string,
): Promise<{ readonly id: string } | null> {
  const recipient = await db
    .select({
      id: users.id,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, recipientId),
        eq(users.isActive, true),
      ),
    )
    .get()

  if (!recipient || !isInternalStaffRole(recipient.role)) return null
  return { id: recipient.id }
}

function canSubmitCherishPulse(user: AuthUser): boolean {
  return canUseFieldDesk(user)
}

function canViewCherishPulse(user: AuthUser): boolean {
  return (
    user.isActive &&
    user.organizationType === "internal" &&
    isInternalStaffRole(user.role)
  )
}

function isValidClientSubmissionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  )
}

function statusForDecision(
  decision: CherishPulseReviewDecision
): CherishPulseReviewStatus {
  return decision === "approve" ? "approved" : "archived"
}

function visibilityForType(
  responseType: CherishPulseResponseType
): CherishPulseVisibility {
  return responseType === "concern" ? "private" : "team"
}

function nameForUser(user: AuthUser): string {
  const displayName = user.displayName?.trim()
  if (displayName) return displayName

  const firstName = user.firstName?.trim() ?? ""
  const lastName = user.lastName?.trim() ?? ""
  const fullName = `${firstName} ${lastName}`.trim()
  return fullName || user.email
}

function weekStartForDate(date: Date): string {
  const utcDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  )
  const dayOfWeek = utcDate.getUTCDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  utcDate.setUTCDate(utcDate.getUTCDate() + mondayOffset)
  return utcDate.toISOString().slice(0, 10)
}

function rowToReviewItem(row: {
  readonly id: string
  readonly cherishValue: string
  readonly responseType: string
  readonly message: string
  readonly source: string
  readonly visibility: string
  readonly reviewStatus: string
  readonly isAnonymous: boolean
  readonly submittedByName: string | null
  readonly submittedByEmail: string | null
  readonly weekStart: string
  readonly createdAt: string
  readonly audienceScope: string
  readonly audienceReferenceId: string | null
}): CherishPulseReviewItem {
  const isAnonymous = row.isAnonymous
  return {
    id: row.id,
    cherishValue: normalizeCherishValue(row.cherishValue),
    responseType: normalizeCherishResponseType(row.responseType),
    message: row.message,
    source: normalizeCherishPulseSource(row.source),
    visibility: normalizeVisibility(row.visibility),
    reviewStatus: normalizeReviewStatus(row.reviewStatus),
    isAnonymous,
    submittedByName: isAnonymous ? null : row.submittedByName,
    submittedByEmail: isAnonymous ? null : row.submittedByEmail,
    weekStart: row.weekStart,
    createdAt: row.createdAt,
    audience:
      row.audienceScope === "user" && row.audienceReferenceId !== null
        ? { scope: "user", recipientId: row.audienceReferenceId }
        : { scope: "company" },
  }
}

function isCherishValue(value: string): value is CherishValue {
  switch (value) {
    case "Camaraderie":
    case "Honor":
    case "Excellence":
    case "Reliability":
    case "Integrity":
    case "Servitude":
    case "Humility":
      return true
    default:
      return false
  }
}

function normalizeCherishValue(value: string): CherishValue {
  return isCherishValue(value) ? value : "Reliability"
}

function isCherishResponseType(value: string): value is CherishPulseResponseType {
  switch (value) {
    case "shoutout":
    case "concern":
    case "win":
      return true
    default:
      return false
  }
}

function normalizeCherishResponseType(value: string): CherishPulseResponseType {
  return isCherishResponseType(value) ? value : "shoutout"
}

function isCherishPulseSource(value: string): value is CherishPulseSource {
  switch (value) {
    case "compass_dashboard":
    case "compass_mobile":
    case "telegram":
    case "exaktime":
    case "admin_entry":
      return true
    default:
      return false
  }
}

function normalizeCherishPulseSource(value: string): CherishPulseSource {
  return isCherishPulseSource(value) ? value : "compass_dashboard"
}

function normalizeVisibility(value: string): CherishPulseVisibility {
  return value === "private" ? "private" : "team"
}

function normalizeReviewStatus(
  value: string
): CherishPulseReviewStatus {
  switch (value) {
    case "approved":
    case "archived":
      return value
    default:
      return "needs_review"
  }
}
