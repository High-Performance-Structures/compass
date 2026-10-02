import "server-only"

import { and, asc, eq, isNotNull } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  gotoInboundEvents,
  notificationPreferences,
  organizationMembers,
  projectContacts,
  projectJobStatuses,
  projects,
  users,
} from "@/db/schema"
import { recordActivityEvent } from "@/lib/activity-log"
import type {
  InboundAttachment,
  InboundCandidate,
} from "@/lib/email/gmail-message-parser"
import { projectInboundEmailAddress } from "@/lib/email/project-address"
import {
  canAutoRouteProjectInboundSms,
  routeProjectInboundSms,
} from "@/lib/email/project-inbound-routing"
import {
  gotoInboundSmsSubject,
  shouldRouteInternalProjectSms,
  type GotoProjectMatchReason,
} from "@/lib/goto/internal-project-routing"
import { gotoAttachmentMimeType } from "@/lib/goto/mime-type"
import { isKnownInternalSmsSender } from "@/lib/goto/internal-sender"
import {
  displaySmsPhoneNumber,
  gotoDepartmentSmsDirectory,
  gotoDepartmentsForOwnerNumber,
  gotoProjectListDepartmentsForOwnerNumber,
  gotoSenderNumberForProject,
  normalizeSmsPhoneNumber,
} from "@/lib/goto/numbers"
import { matchGotoInboundProject } from "@/lib/goto/project-matcher"
import type { GotoInboundMessage } from "@/lib/goto/notification-parser"
import {
  inboundRouteLabel,
  parseStaffSmsCommand,
  projectSmsHelp,
  projectListSmsChunks,
  type StaffSmsCommand,
} from "@/lib/goto/staff-commands"
import {
  getGotoAccessToken,
  queueSmsDelivery,
} from "@/lib/notifications/create-event"
import {
  MAX_PHOTO_UPLOAD_BATCH_BYTES,
  MAX_PHOTO_UPLOAD_FILE_BYTES,
} from "@/lib/photos/upload-limits"
import {
  projectJobStatusBucket,
  projectJobStatusLabel,
  projectNumberParts,
} from "@/lib/project-profile"
import type { ProjectDepartment } from "@/lib/project-branding"

type Db = ReturnType<typeof getDb>

async function isInternalSender(input: {
  readonly db: Db
  readonly organizationId: string
  readonly senderPhone: string
}): Promise<boolean> {
  const candidates = await input.db
    .select({
      role: organizationMembers.role,
      smsEnabled: notificationPreferences.smsEnabled,
      smsPhoneNumber: notificationPreferences.smsPhoneNumber,
      smsConsentAccepted: notificationPreferences.smsConsentAccepted,
      smsConsentDisclosureVersion:
        notificationPreferences.smsConsentDisclosureVersion,
      smsConsentPhoneNumber: notificationPreferences.smsConsentPhoneNumber,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .leftJoin(
      notificationPreferences,
      eq(notificationPreferences.userId, users.id)
    )
    .where(
      and(
        eq(organizationMembers.organizationId, input.organizationId),
        eq(users.isActive, true)
      )
    )

  return isKnownInternalSmsSender(input.senderPhone, candidates)
}

function replyProjectNumber(
  departments: readonly ProjectDepartment[]
): string | null {
  const department = departments[0]
  return department ? `${department}-0-SMS` : null
}

async function sendSmsReply(input: {
  readonly env: unknown
  readonly senderPhone: string
  readonly departments: readonly ProjectDepartment[]
  readonly title: string
  readonly bodies: readonly string[]
}): Promise<void> {
  const projectNumber = replyProjectNumber(input.departments)
  for (let index = 0; index < input.bodies.length; index += 1) {
    const body = input.bodies[index]
    if (!body) continue
    const title =
      input.bodies.length === 1
        ? input.title
        : `${input.title} ${index + 1}/${input.bodies.length}`
    try {
      const delivery = await queueSmsDelivery(
        input.env,
        input.senderPhone,
        title,
        body,
        projectNumber
      )
      if (delivery.status !== "sent") {
        console.error("[goto-inbound] Staff SMS reply was not sent", {
          provider: delivery.provider,
          status: delivery.status,
          error: delivery.error,
        })
      }
    } catch (error) {
      // Replies are best-effort. An outbound provider failure must not change
      // the persisted result of an inbound command or project update.
      console.error("[goto-inbound] Staff SMS reply failed", {
        error: error instanceof Error ? error.message : "Unknown SMS error",
      })
    }
  }
}

async function activeDepartmentProjects(input: {
  readonly db: Db
  readonly organizationId: string
  readonly departments: readonly ProjectDepartment[]
}): Promise<
  readonly {
    readonly name: string
    readonly projectNumber: string
    readonly department: ProjectDepartment
  }[]
> {
  const rows = await input.db
    .select({
      name: projects.name,
      projectNumber: projects.projectNumber,
      jobStatusId: projects.jobStatusId,
      customJobStatusLabel: projectJobStatuses.label,
    })
    .from(projects)
    .leftJoin(
      projectJobStatuses,
      and(
        eq(projectJobStatuses.id, projects.jobStatusId),
        eq(projectJobStatuses.organizationId, projects.organizationId)
      )
    )
    .where(eq(projects.organizationId, input.organizationId))
    .orderBy(asc(projects.projectNumber), asc(projects.name))
  const departments = new Set(input.departments)

  return rows.flatMap((row) => {
    if (!row.projectNumber) return []
    const parts = projectNumberParts(row.projectNumber)
    if (!parts || !departments.has(parts.department)) return []
    const jobStatusLabel = projectJobStatusLabel({
      jobStatusId: row.jobStatusId,
      customLabel: row.customJobStatusLabel,
    })
    if (
      projectJobStatusBucket({
        jobStatusId: row.jobStatusId,
        jobStatusLabel,
      }) !== "active"
    ) {
      return []
    }
    return [
      {
        name: row.name,
        projectNumber: row.projectNumber,
        department: parts.department,
      },
    ]
  })
}

async function handleStaffCommand(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly message: GotoInboundMessage
  readonly command: Extract<
    StaffSmsCommand,
    { readonly kind: "list" | "invalid_list" }
  >
}): Promise<void> {
  const availableDepartments = gotoDepartmentsForOwnerNumber(
    input.env,
    input.message.ownerTouchpoint
  )
  const listDepartments = gotoProjectListDepartmentsForOwnerNumber(
    input.env,
    input.message.ownerTouchpoint
  )
  let bodies: readonly string[]

  if (input.command.kind === "invalid_list") {
    bodies = ["Use [list], [list O], [list D], [list H], or [list N]."]
  } else if (
    input.command.department !== null &&
    !listDepartments.includes(input.command.department)
  ) {
    bodies = [
      `${input.command.department} projects are not served by this text number. Text [list] to see this number's departments.`,
    ]
  } else {
    const departments = input.command.department
      ? [input.command.department]
      : listDepartments
    const activeProjects = await activeDepartmentProjects({
      db: input.db,
      organizationId: input.organizationId,
      departments,
    })
    bodies = projectListSmsChunks({
      departments,
      projects: activeProjects,
    })
  }

  await sendSmsReply({
    env: input.env,
    senderPhone: input.message.senderPhone,
    departments: availableDepartments,
    title: "Compass project list",
    bodies,
  })
  const senderDigits = input.message.senderPhone.replace(/\D/g, "")
  await recordActivityEvent({
    db: input.db,
    id: `staff-sms-command-${input.message.messageId}`,
    organizationId: input.organizationId,
    projectId: null,
    actor: {
      id: null,
      email: `sms:${input.message.senderPhone}`,
      displayName: `Staff text sender ending ${senderDigits.slice(-4) || "unknown"}`,
      firstName: null,
      lastName: null,
      role: "staff_sms",
    },
    category: "conversation",
    action: "staff_sms.command.list",
    entityType: "staff_sms_command",
    entityId: input.message.messageId,
    summary: "A verified staff member requested the active project list by text.",
    metadata: {
      requestedDepartment:
        input.command.kind === "list" ? input.command.department : null,
      receivingDepartments: availableDepartments.join(","),
      listedDepartments: listDepartments.join(","),
    },
    createdAt: input.message.receivedAt,
  })
}

async function handleSmsHelpCommand(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly message: GotoInboundMessage
}): Promise<void> {
  const departments = gotoDepartmentsForOwnerNumber(
    input.env,
    input.message.ownerTouchpoint
  )
  await sendSmsReply({
    env: input.env,
    senderPhone: input.message.senderPhone,
    departments,
    title: "Compass text help",
    bodies: [
      projectSmsHelp(
        gotoDepartmentSmsDirectory(input.env).map((department) => ({
          ...department,
          phoneNumber: displaySmsPhoneNumber(department.phoneNumber),
        }))
      ),
    ],
  })
  const senderDigits = input.message.senderPhone.replace(/\D/g, "")
  await recordActivityEvent({
    db: input.db,
    id: `sms-help-command-${input.message.messageId}`,
    organizationId: input.organizationId,
    projectId: null,
    actor: {
      id: null,
      email: `sms:${input.message.senderPhone}`,
      displayName: `Text sender ending ${senderDigits.slice(-4) || "unknown"}`,
      firstName: null,
      lastName: null,
      role: "sms_sender",
    },
    category: "conversation",
    action: "sms.command.help",
    entityType: "sms_command",
    entityId: input.message.messageId,
    summary: "A text sender requested Compass project-text instructions.",
    metadata: { receivingDepartments: departments.join(",") },
    createdAt: input.message.receivedAt,
  })
}

async function handleUnverifiedListCommand(input: {
  readonly env: unknown
  readonly message: GotoInboundMessage
}): Promise<void> {
  const departments = gotoDepartmentsForOwnerNumber(
    input.env,
    input.message.ownerTouchpoint
  )
  await sendSmsReply({
    env: input.env,
    senderPhone: input.message.senderPhone,
    departments,
    title: "Compass project list",
    bodies: [
      "Project lists are available to verified staff numbers only. Text [help] for project update instructions.",
    ],
  })
}

async function projectForMessage(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly body: string
  readonly senderPhone: string
  readonly ownerTouchpoint: string
  readonly conversationId: string | null
}): Promise<
  | {
      readonly kind: "found"
      readonly id: string
      readonly projectNumber: string | null
      readonly reason: GotoProjectMatchReason
    }
  | { readonly kind: "missing" | "ambiguous" }
> {
  const rows = await input.db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      status: projects.status,
      contactPhone: projectContacts.phone,
      contactType: projectContacts.contactType,
      primaryContact: projectContacts.primaryContact,
    })
    .from(projects)
    .leftJoin(
      projectContacts,
      and(
        eq(projectContacts.projectId, projects.id),
        eq(projectContacts.active, true)
      )
    )
    .where(eq(projects.organizationId, input.organizationId))
  const priorConversationProjectIds = input.conversationId
    ? await input.db
        .select({ projectId: gotoInboundEvents.projectId })
        .from(gotoInboundEvents)
        .where(
          and(
            eq(gotoInboundEvents.organizationId, input.organizationId),
            eq(gotoInboundEvents.conversationId, input.conversationId),
            eq(gotoInboundEvents.status, "processed"),
            isNotNull(gotoInboundEvents.projectId)
          )
        )
        .then((events) =>
          events.flatMap((event) =>
            event.projectId === null ? [] : [event.projectId]
          )
        )
    : []
  const ownerPhone = normalizeSmsPhoneNumber(input.ownerTouchpoint)
  const match = matchGotoInboundProject({
    body: input.body,
    senderPhone: input.senderPhone,
    priorConversationProjectIds,
    candidates: rows.map((row) => ({
      ...row,
      ownerNumberMatches:
        gotoSenderNumberForProject(input.env, row.projectNumber) === ownerPhone,
    })),
  })
  if (match.kind !== "found") return { kind: match.kind }
  return {
    kind: "found",
    id: match.id,
    projectNumber: match.projectNumber,
    reason: match.reason,
  }
}

export async function downloadGotoInboundAttachments(input: {
  readonly env: unknown
  readonly message: GotoInboundMessage
}): Promise<readonly InboundAttachment[]> {
  const declaredBytes = input.message.attachments.reduce(
    (total, attachment) => total + (attachment.size ?? 0),
    0
  )
  if (declaredBytes > MAX_PHOTO_UPLOAD_BATCH_BYTES) {
    throw new Error("Text attachments exceed the 90 MB batch limit.")
  }
  const oversized = input.message.attachments.find(
    (attachment) =>
      attachment.size !== null && attachment.size > MAX_PHOTO_UPLOAD_FILE_BYTES
  )
  if (oversized) throw new Error(`${oversized.name} exceeds the 50 MB file limit.`)

  const token = await getGotoAccessToken(input.env)
  if (!token.success) throw new Error(token.error)
  const attachments: InboundAttachment[] = []
  let actualBytes = 0
  for (const attachment of input.message.attachments) {
    const response = await fetch(
      `https://api.goto.com/messaging/v2/accounts/${encodeURIComponent(input.message.accountKey)}/attachments/${encodeURIComponent(attachment.attachmentId)}`,
      {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        redirect: "follow",
      }
    )
    if (!response.ok) {
      throw new Error(`GoTo attachment download failed (${response.status}).`)
    }
    const contentLength = Number(response.headers.get("content-length") ?? "0")
    if (contentLength > MAX_PHOTO_UPLOAD_FILE_BYTES) {
      throw new Error(`${attachment.name} exceeds the 50 MB file limit.`)
    }
    const data = new Uint8Array(await response.arrayBuffer())
    if (data.byteLength > MAX_PHOTO_UPLOAD_FILE_BYTES) {
      throw new Error(`${attachment.name} exceeds the 50 MB file limit.`)
    }
    actualBytes += data.byteLength
    if (actualBytes > MAX_PHOTO_UPLOAD_BATCH_BYTES) {
      throw new Error("Text attachments exceed the 90 MB batch limit.")
    }
    const mimeType = gotoAttachmentMimeType({
      declaredType: attachment.contentType,
      responseType: response.headers.get("content-type"),
      fileName: attachment.name,
      data,
    })
    attachments.push({
      attachmentId: attachment.attachmentId,
      fileName: attachment.name,
      mimeType,
      size: data.byteLength,
      data,
    })
  }
  return attachments
}

export async function processGotoInboundMessage(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly message: GotoInboundMessage
}): Promise<{
  readonly projectId: string | null
  readonly status: "dismissed" | "processed" | "needs_review"
  readonly reviewReason:
    | "missing_project"
    | "ambiguous_project"
    | "routing_review"
    | "internal_sender"
    | null
}> {
  const internalSender = await isInternalSender({
    db: input.db,
    organizationId: input.organizationId,
    senderPhone: input.message.senderPhone,
  })
  const command = parseStaffSmsCommand(input.message.body)
  if (command.kind === "help") {
    await handleSmsHelpCommand({
      env: input.env,
      db: input.db,
      organizationId: input.organizationId,
      message: input.message,
    })
    return {
      projectId: null,
      status: "processed",
      reviewReason: null,
    }
  }
  if (
    internalSender &&
    (command.kind === "list" || command.kind === "invalid_list")
  ) {
    await handleStaffCommand({
      env: input.env,
      db: input.db,
      organizationId: input.organizationId,
      message: input.message,
      command,
    })
    return {
      projectId: null,
      status: "processed",
      reviewReason: null,
    }
  }
  if (command.kind === "list" || command.kind === "invalid_list") {
    await handleUnverifiedListCommand({
      env: input.env,
      message: input.message,
    })
    return {
      projectId: null,
      status: "processed",
      reviewReason: null,
    }
  }

  const project = await projectForMessage({
    env: input.env,
    db: input.db,
    organizationId: input.organizationId,
    body: input.message.body,
    senderPhone: input.message.senderPhone,
    ownerTouchpoint: input.message.ownerTouchpoint,
    conversationId: input.message.conversationId,
  })
  if (
    internalSender &&
    (project.kind !== "found" ||
      !shouldRouteInternalProjectSms({
        body: input.message.body,
        projectNumber: project.projectNumber,
        matchReason: project.reason,
      }))
  ) {
    const senderDigits = input.message.senderPhone.replace(/\D/g, "")
    console.info("[goto-inbound] Internal staff SMS auto-dismissed", {
      messageId: input.message.messageId,
      senderSuffix: senderDigits.slice(-4) || "unknown",
    })
    return {
      projectId: null,
      status: "dismissed",
      reviewReason: "internal_sender",
    }
  }

  if (project.kind !== "found") {
    console.warn("[goto-inbound] SMS needs review", {
      messageId: input.message.messageId,
      reason: project.kind,
    })
    const senderDigits = input.message.senderPhone.replace(/\D/g, "")
    const senderSuffix = senderDigits.slice(-4) || "unknown"
    await recordActivityEvent({
      db: input.db,
      id: `project-sms-review-${input.message.messageId}`,
      organizationId: input.organizationId,
      projectId: null,
      actor: {
        id: null,
        email: `sms:${input.message.senderPhone}`,
        displayName: `Text sender ending ${senderSuffix}`,
        firstName: null,
        lastName: null,
        role: "project_sms",
      },
      category: "conversation",
      action: "project_goto_sms.needs_review",
      entityType: "project_goto_sms",
      entityId: input.message.messageId,
      summary: "Incoming text message is awaiting project and destination review.",
      metadata: {
        reason:
          project.kind === "missing" ? "missing_project" : "ambiguous_project",
        bodyRetained: true,
        attachmentCount: input.message.attachments.length,
      },
      createdAt: input.message.receivedAt,
    })
    return {
      projectId: null,
      status: "needs_review",
      reviewReason:
        project.kind === "missing" ? "missing_project" : "ambiguous_project",
    }
  }
  const subject = gotoInboundSmsSubject({
    body: input.message.body,
    projectNumber: project.projectNumber,
  })
  const canAutoRoute = await canAutoRouteProjectInboundSms({
    db: input.db,
    organizationId: input.organizationId,
    projectId: project.id,
    senderPhone: input.message.senderPhone,
  })
  // Unverified senders remain fully visible in the review queue, including
  // attachment metadata, but bytes are fetched only after staff approval.
  const attachments = canAutoRoute
    ? await downloadGotoInboundAttachments({
        env: input.env,
        message: input.message,
      })
    : []
  const candidate: InboundCandidate = {
    gmailMessageId: input.message.messageId,
    gmailThreadId: input.message.conversationId,
    messageIdHeader: null,
    inReplyToHeader: null,
    referencesHeader: null,
    token: null,
    fromAddress: `sms:${input.message.senderPhone}`,
    fromName: null,
    toAddress: projectInboundEmailAddress(project.id),
    subject,
    textBody: input.message.body,
    htmlBody: null,
    snippet: input.message.body.slice(0, 240),
    receivedAt: input.message.receivedAt,
    attachments,
  }
  const result = await routeProjectInboundSms({
    env: input.env,
    db: input.db,
    organizationId: input.organizationId,
    projectId: project.id,
    senderPhone: input.message.senderPhone,
    candidate,
  })
  if (internalSender) {
    const body =
      result.kind === "routed"
        ? `Saved ${project.projectNumber ?? "the project update"} as ${inboundRouteLabel(result.matchedStatus)}.`
        : `Received ${project.projectNumber ?? "the project update"}, but it needs office review.`
    await sendSmsReply({
      env: input.env,
      senderPhone: input.message.senderPhone,
      departments: gotoDepartmentsForOwnerNumber(
        input.env,
        input.message.ownerTouchpoint
      ),
      title: "Compass received",
      bodies: [body],
    })
  }
  return {
    projectId: project.id,
    status: result.kind === "needs_review" ? "needs_review" : "processed",
    reviewReason: result.kind === "needs_review" ? "routing_review" : null,
  }
}
