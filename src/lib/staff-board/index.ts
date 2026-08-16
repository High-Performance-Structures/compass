import { and, eq, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import {
  notificationPreferences,
  organizations,
  organizationMembers,
  users,
} from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isInternalStaffRole, USER_ROLES } from "@/lib/user-roles"

const MAX_TITLE_LENGTH = 120
const MAX_BODY_LENGTH = 5000
const INTERNAL_STAFF_ROLES = USER_ROLES.filter(isInternalStaffRole)

export type StaffBoardPostInput = { readonly title: string; readonly body: string }
export type StaffBoardValidationResult =
  | { readonly success: true; readonly data: StaffBoardPostInput }
  | { readonly success: false; readonly error: string }
export type StaffBoardMembershipCheck = {
  readonly userId: string
  readonly requestedUserId: string
  readonly memberOrganizationId: string
  readonly requestedOrganizationId: string
  readonly userIsActive: boolean
  readonly organizationIsActive: boolean
  readonly organizationType: string
  readonly memberRole: string
}
export type StaffBoardRecipientRow = {
  readonly userId: string
  readonly email: string
  readonly organizationId: string
  readonly isActive: boolean
  readonly role: string
}
export type StaffBoardRecipient = { readonly userId: string; readonly email: string }

export function canAccessStaffBoard(role: string | null | undefined, isActive: boolean, organizationType: string | null | undefined): boolean {
  if (!isActive || organizationType !== "internal" || role === null || role === undefined) return false
  return isInternalStaffRole(role)
}

export function isActiveInternalStaffMembership(membership: StaffBoardMembershipCheck): boolean {
  return membership.userId === membership.requestedUserId &&
    membership.memberOrganizationId === membership.requestedOrganizationId &&
    membership.userIsActive && membership.organizationIsActive &&
    membership.organizationType === "internal" && isInternalStaffRole(membership.memberRole)
}

export function selectStaffBoardRecipients(rows: readonly StaffBoardRecipientRow[], authorId: string, organizationId: string): readonly StaffBoardRecipient[] {
  return rows.filter((row) => row.userId !== authorId && row.organizationId === organizationId && row.isActive && isInternalStaffRole(row.role)).map((row) => ({ userId: row.userId, email: row.email }))
}

export async function hasActiveStaffBoardOrganization(user: AuthUser): Promise<boolean> {
  if (!user.organizationId || !canAccessStaffBoard(user.role, user.isActive, user.organizationType)) return false
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const rows = await db.select({
    userId: users.id,
    requestedUserId: users.id,
    memberOrganizationId: organizationMembers.organizationId,
    requestedOrganizationId: organizations.id,
    userIsActive: users.isActive,
    organizationIsActive: organizations.isActive,
    organizationType: organizations.type,
    memberRole: organizationMembers.role,
  }).from(users).innerJoin(organizationMembers, eq(organizationMembers.userId, users.id)).innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId)).where(and(
    eq(users.id, user.id), eq(organizationMembers.organizationId, user.organizationId), eq(organizations.id, user.organizationId),
    eq(users.isActive, true), eq(organizations.isActive, true), eq(organizations.type, "internal"), inArray(organizationMembers.role, INTERNAL_STAFF_ROLES)
  )).limit(1)
  return rows.some(isActiveInternalStaffMembership)
}

export async function getActiveStaffBoardOrganization(user: AuthUser): Promise<string | null> {
  if (!(await hasActiveStaffBoardOrganization(user))) return null
  return user.organizationId
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null }

export function validateStaffBoardPost(input: unknown): StaffBoardValidationResult {
  if (!isRecord(input)) return { success: false, error: "Add a title and message." }
  const title = typeof input.title === "string" ? input.title.trim() : ""
  const body = typeof input.body === "string" ? input.body.trim() : ""
  if (title.length === 0) return { success: false, error: "Add a title." }
  if (body.length === 0) return { success: false, error: "Add a message." }
  if (title.length > MAX_TITLE_LENGTH) return { success: false, error: `Titles must be ${MAX_TITLE_LENGTH} characters or fewer.` }
  if (body.length > MAX_BODY_LENGTH) return { success: false, error: `Messages must be ${MAX_BODY_LENGTH.toLocaleString()} characters or fewer.` }
  return { success: true, data: { title, body } }
}

export async function getStaffBoardRecipients(db: ReturnType<typeof getDb>, organizationId: string, authorId: string): Promise<readonly StaffBoardRecipient[]> {
  const rows = await db.select({
    userId: users.id,
    email: users.email,
    organizationId: organizationMembers.organizationId,
    isActive: users.isActive,
    role: organizationMembers.role,
    inAppEnabled: notificationPreferences.inAppEnabled,
  }).from(organizationMembers).innerJoin(users, eq(users.id, organizationMembers.userId)).innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId)).leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id)).where(and(
    eq(organizationMembers.organizationId, organizationId), eq(organizations.id, organizationId), eq(organizations.type, "internal"), eq(organizations.isActive, true), eq(users.isActive, true), inArray(organizationMembers.role, INTERNAL_STAFF_ROLES)
  ))
  return selectStaffBoardRecipients(rows.filter((row) => row.inAppEnabled !== false), authorId, organizationId)
}
