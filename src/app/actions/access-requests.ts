"use server"

/**
 * Request access: thin adapters over src/lib/domain/access-requests. The
 * person asking uses the first group (any signed-in user); a company's
 * admins use the second (Settings > People > Access requests).
 */
import { revalidatePath } from "next/cache"

import { actionFailure, errorMessage, type ActionDone, type ActionResult } from "@/lib/action-result"
import {
  approvalEmailText,
  declineEmailText,
  emailAccessRequestDecision,
  notifyAccessRequestDeciders,
} from "@/lib/domain/access-requests/notify"
import {
  companyAccessRequest,
  companyAccessRequests,
  hasCompanyMembership,
  myAccessRequests,
  requestableOrganizationsFor,
  listAccessRequestDirectory,
  type AccessRequestDirectoryOption,
  type CompanyAccessRequest,
  type MyAccessRequest,
  type RequestableOrganization,
} from "@/lib/domain/access-requests/queries"
import { canDecideAccessRequests, type AccessRequestInput, type ApproveAccessRequestInput } from "@/lib/domain/access-requests/rules"
import {
  approveAccessRequest,
  declineAccessRequest,
  submitAccessRequest,
  withdrawAccessRequest,
} from "@/lib/domain/access-requests/service"
import { orgContext, userContext, type OrgContext } from "@/lib/server/action-context"

const REQUEST_PAGE = "/dashboard/request-access"
const SETTINGS_PAGE = "/dashboard/settings"

// ---------------------------------------------------------------------------
// The person asking
// ---------------------------------------------------------------------------

export type RequestAccessPageData = {
  readonly companies: readonly RequestableOrganization[]
  readonly requests: readonly MyAccessRequest[]
  /** False until the person belongs to a company (their personal workspace doesn't count). */
  readonly hasCompany: boolean
  readonly email: string
}

export async function getRequestAccessPageData(): Promise<ActionResult<RequestAccessPageData>> {
  const context = await userContext()
  if (!context.success) return context
  const { db, user } = context.data
  try {
    const [companies, requests, hasCompany] = await Promise.all([
      requestableOrganizationsFor(db, user.id),
      myAccessRequests(db, user.id),
      hasCompanyMembership(db, user.id),
    ])
    const pending = new Set(requests.filter((request) => request.status === "pending").map((request) => request.organizationId))
    return {
      success: true,
      // A company with a pending request shows under "Your requests" instead.
      data: { companies: companies.filter((company) => !pending.has(company.id)), requests, hasCompany, email: user.email },
    }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to load access requests."))
  }
}

export async function requestCompanyAccess(input: AccessRequestInput): Promise<ActionResult<{ readonly organizationName: string }>> {
  const context = await userContext({ mutation: true })
  if (!context.success) return context
  const { db, user } = context.data
  try {
    const result = await submitAccessRequest(db, user, input)
    if (!result.success) return result
    await notifyAccessRequestDeciders(db, result.data)
    revalidatePath(REQUEST_PAGE)
    return { success: true, data: { organizationName: result.data.organizationName } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to send the request."))
  }
}

export async function withdrawCompanyAccessRequest(requestId: string): Promise<ActionDone> {
  const context = await userContext({ mutation: true })
  if (!context.success) return context
  try {
    const result = await withdrawAccessRequest(context.data.db, context.data.user, requestId)
    if (!result.success) return result
    revalidatePath(REQUEST_PAGE)
    return { success: true }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to withdraw the request."))
  }
}

// ---------------------------------------------------------------------------
// The company's admins
// ---------------------------------------------------------------------------

async function deciderContext(mutation: boolean): Promise<ActionResult<OrgContext>> {
  const context = await orgContext({ mutation })
  if (!context.success) return context
  const { user } = context.data
  if (!user.isActive || !canDecideAccessRequests(user.role)) {
    return actionFailure("Only an account administrator can review access requests.")
  }
  return context
}

function actorOf(context: OrgContext) {
  return { ...context.user, organizationId: context.organizationId }
}

export async function getCompanyAccessRequests(): Promise<ActionResult<readonly CompanyAccessRequest[]>> {
  const context = await deciderContext(false)
  if (!context.success) return context
  try {
    return { success: true, data: await companyAccessRequests(context.data.db, context.data.organizationId) }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to load access requests."))
  }
}

/**
 * Directory people to link a request to: client people for a client, vendor
 * people for a vendor. With no search, people whose email matches the
 * requester's are suggested.
 */
export async function getAccessRequestDirectoryOptions(
  requestId: string,
  search: string,
): Promise<ActionResult<readonly AccessRequestDirectoryOption[]>> {
  const context = await deciderContext(false)
  if (!context.success) return context
  const { db, organizationId } = context.data
  try {
    const found = await companyAccessRequest(db, organizationId, requestId)
    if (!found) return actionFailure("Request not found.")
    const base = { organizationId, kind: found.request.kind, requesterUserId: found.request.userId }
    return { success: true, data: await listAccessRequestDirectory(db, { ...base, requesterEmail: found.requesterEmail, search }) }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to search the directory."))
  }
}

export type AccessRequestDecisionResult = ActionResult<{
  /** Jobs opened by an approval. */
  readonly projects: number
  /** Staff-only jobs that were not opened. */
  readonly skippedProjects: readonly string[]
  /** Set when the decision stands but the email didn't go out. */
  readonly warning: string | null
}>

export async function approveCompanyAccessRequest(input: ApproveAccessRequestInput): Promise<AccessRequestDecisionResult> {
  const context = await deciderContext(true)
  if (!context.success) return context
  const { db, env, user } = context.data
  try {
    const result = await approveAccessRequest(db, env.DB, actorOf(context.data), input)
    if (!result.success) return result
    const warning = await emailAccessRequestDecision({
      env, db, actor: user, request: result.data, decision: "approved", message: approvalEmailText(env, result.data),
    })
    revalidatePath(SETTINGS_PAGE)
    revalidatePath("/dashboard/contacts")
    revalidatePath("/dashboard/projects", "layout")
    return { success: true, data: { projects: result.data.projects.length, skippedProjects: result.data.skippedProjects, warning } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to approve the request."))
  }
}

export async function declineCompanyAccessRequest(requestId: string): Promise<AccessRequestDecisionResult> {
  const context = await deciderContext(true)
  if (!context.success) return context
  const { db, env, user } = context.data
  try {
    const result = await declineAccessRequest(db, actorOf(context.data), requestId)
    if (!result.success) return result
    const warning = await emailAccessRequestDecision({
      env, db, actor: user, request: result.data, decision: "declined", message: declineEmailText(result.data),
    })
    revalidatePath(SETTINGS_PAGE)
    return { success: true, data: { projects: 0, skippedProjects: [], warning } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to decline the request."))
  }
}
