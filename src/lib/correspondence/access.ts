import { and, eq, inArray, isNull } from "drizzle-orm"
import { getDb } from "@/db"
import { organizationMembers, organizations, projectMembers, projects, users } from "@/db/schema"
import { correspondence, correspondenceParticipants } from "@/db/schema-correspondence"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { isDemoUser } from "@/lib/demo"
import { getCloudflareContext } from "@/lib/db"
import { getProjectAccessRecord } from "@/lib/project-access"
import { getProjectAudienceStaff } from "@/lib/project-audience-staff"
import { isInternalStaffRole } from "@/lib/user-roles"
import type { CorrespondencePerson } from "./types"

export function isCorrespondenceEnabled(projectId: string, environment: unknown = process.env): boolean {
  if (typeof environment !== "object" || environment === null) return false
  // Rollout controls availability only; context and message grants still authorize every read/write.
  if ("COMPASS_CORRESPONDENCE_ENABLED" in environment && environment.COMPASS_CORRESPONDENCE_ENABLED === "true") return true
  if (!("COMPASS_CORRESPONDENCE_PROJECT_IDS" in environment)) return false
  const value = environment.COMPASS_CORRESPONDENCE_PROJECT_IDS
  return typeof value === "string" && value.split(",").map((id) => id.trim()).filter(Boolean).includes(projectId)
}

export type CorrespondenceContext = {
  readonly db: ReturnType<typeof getDb>
  readonly env: unknown
  readonly user: AuthUser
  readonly projectId: string
  readonly organizationId: string
  readonly projectName: string
  readonly workspace: "staff" | "owner" | "sub_vendor"
}

export async function correspondenceContext(projectId: string): Promise<CorrespondenceContext> {
  const user = await requireAuth()
  const { env } = await getCloudflareContext()
  if (!isCorrespondenceEnabled(projectId, env) && !isCorrespondenceEnabled(projectId)) throw new Error("Project messaging is not enabled for this project yet.")
  if (isDemoUser(user.id)) throw new Error("Demo mode is read-only.")
  if (!user.isActive) throw new Error("Project not found.")
  const db = getDb(env.DB)
  const project = await getProjectAccessRecord(db, user, projectId)
  if (!project?.organizationId) throw new Error("Project not found.")
  const row = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId)).get()
  const membership = await db.select({ role: projectMembers.role }).from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id))).get()
  // A project invite remains valid when another organization is active in the shell.
  // Classify the actor using this project's organization, never the active-org role.
  const organizationMembership = await db.select({ role: organizationMembers.role, type: organizations.type }).from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(organizationMembers.organizationId, project.organizationId), eq(organizationMembers.userId, user.id))).get()
  if (!organizationMembership) throw new Error("Project not found.")
  const role = membership?.role ?? organizationMembership.role
  const staff = organizationMembership.type === "internal" && isInternalStaffRole(organizationMembership.role)
  const workspace = staff ? "staff" : role === "client" || role === "owner" ? "owner" : role === "subcontractor" || role === "supplier" ? "sub_vendor" : null
  if (!workspace || workspace !== "staff" && !membership) throw new Error("Project not found.")
  return { db, env, user, projectId, organizationId: project.organizationId, projectName: row?.name ?? "Project", workspace }
}

export async function correspondenceContacts(ctx: CorrespondenceContext): Promise<readonly CorrespondencePerson[]> {
  if (ctx.workspace !== "staff") {
    const staff = await getProjectAudienceStaff(ctx.db, { projectId: ctx.projectId, organizationId: ctx.organizationId, audience: ctx.workspace })
    return staff.map((person) => ({ userId: person.userId, name: person.displayName, email: person.email, role: "staff", delivery: "compass" }))
  }
  const rows = await ctx.db.select({ userId: users.id, name: users.displayName, email: users.email, role: projectMembers.role, organizationRole: organizationMembers.role })
    .from(projectMembers).innerJoin(users, eq(users.id, projectMembers.userId))
    .innerJoin(organizationMembers, and(eq(organizationMembers.userId, users.id), eq(organizationMembers.organizationId, ctx.organizationId)))
    .where(and(eq(projectMembers.projectId, ctx.projectId), eq(users.isActive, true)))
  const selectedStaff = [...await getProjectAudienceStaff(ctx.db, { projectId: ctx.projectId, organizationId: ctx.organizationId, audience: "owner" }), ...await getProjectAudienceStaff(ctx.db, { projectId: ctx.projectId, organizationId: ctx.organizationId, audience: "sub_vendor" })]
  const projectPeople = rows.flatMap((row): CorrespondencePerson[] => {
    const role = isInternalStaffRole(row.organizationRole) ? "staff" : row.role === "client" || row.role === "owner" ? "owner" : row.role === "subcontractor" || row.role === "supplier" ? "sub_vendor" : null
    return role ? [{ userId: row.userId, name: row.name ?? row.email, email: row.email, role, delivery: "compass" }] : []
  })
  for (const person of selectedStaff) if (!projectPeople.some((p) => p.userId === person.userId)) projectPeople.push({ userId: person.userId, name: person.displayName, email: person.email, role: "staff", delivery: "compass" })
  return projectPeople
}

export async function authorizedConversation(ctx: CorrespondenceContext, conversationId: string): Promise<typeof correspondence.$inferSelect> {
  const row = await ctx.db.select({ conversation: correspondence }).from(correspondence)
    .innerJoin(correspondenceParticipants, and(eq(correspondenceParticipants.conversationId, correspondence.id), eq(correspondenceParticipants.userId, ctx.user.id), isNull(correspondenceParticipants.revokedAt)))
    .where(and(eq(correspondence.id, conversationId), eq(correspondence.projectId, ctx.projectId), eq(correspondence.organizationId, ctx.organizationId))).get()
  if (!row || !(await currentParticipants(ctx, conversationId)).some((p) => p.userId === ctx.user.id)) throw new Error("Conversation not found.")
  return row.conversation
}

export async function currentParticipants(ctx: CorrespondenceContext, conversationId: string): Promise<readonly CorrespondencePerson[]> {
  const rows = await ctx.db.select().from(correspondenceParticipants).where(and(eq(correspondenceParticipants.conversationId, conversationId), isNull(correspondenceParticipants.revokedAt)))
  if (!rows.length) return []
  const active = await ctx.db.select({ id: users.id, currentName: users.displayName, currentEmail: users.email, orgRole: organizationMembers.role, projectRole: projectMembers.role }).from(users)
    .innerJoin(organizationMembers, and(eq(organizationMembers.userId, users.id), eq(organizationMembers.organizationId, ctx.organizationId)))
    .leftJoin(projectMembers, and(eq(projectMembers.userId, users.id), eq(projectMembers.projectId, ctx.projectId)))
    .where(and(inArray(users.id, rows.map((r) => r.userId)), eq(users.isActive, true)))
  return rows.filter((r) => active.some((person) => person.id === r.userId && (
    r.role === "staff" ? isInternalStaffRole(person.orgRole) : r.role === "owner" ? ["owner", "client"].includes(person.projectRole ?? "") : ["subcontractor", "supplier"].includes(person.projectRole ?? "")
  ))).map((r) => {
    const person = active.find((entry) => entry.id === r.userId)
    return { userId: r.userId, name: person?.currentName ?? person?.currentEmail ?? r.name, email: person?.currentEmail ?? r.email, role: r.role, delivery: "compass" }
  })
}
