import { z } from "zod/v4"

import { DAILY_LOG_OPTIONAL_FIELDS } from "../daily-logs/daily-log-form"
import { DAILY_LOG_TODO_MODES, DAILY_LOG_TODO_TYPES } from "../daily-logs/log-followups"
import { MACHINE_LOG_KINDS } from "../equipment/model"

export const fieldProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectNumber: z.string().nullable(),
  address: z.string().nullable(),
})

export const fieldUserProfileSchema = z.object({
  name: z.string(),
  email: z.string(),
  role: z.string(),
})

const fieldTaskSchema = z.object({
  id: z.string(),
  kind: z.enum(["schedule", "task"]),
  title: z.string(),
  description: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  phase: z.string(),
  status: z.string(),
  priority: z.string(),
  percentComplete: z.number(),
  isCriticalPath: z.boolean(),
  isMilestone: z.boolean(),
  assignedTo: z.string().nullable(),
})

const fieldLogSchema = z.object({
  id: z.string(),
  logDate: z.string(),
  workCompleted: z.string(),
  issues: z.string().nullable(),
  notes: z.string().nullable(),
  authorName: z.string().nullable(),
  syncStatus: z.string(),
})

export const fieldDocumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  mimeType: z.string().nullable(),
  modifiedAt: z.string(),
  webViewLink: z.string().nullable(),
})

const fieldChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
})

const fieldContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
})

const fieldMessageSchema = z.object({
  id: z.string(),
  content: z.string(),
  createdAt: z.string(),
  userName: z.string(),
})

const fieldDirectConversationSchema = z.object({
  id: z.string(),
  name: z.string(),
  unreadCount: z.number(),
  messages: z.array(fieldMessageSchema),
})

const fieldNotificationSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  href: z.string(),
  projectId: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
})

/** Open to-dos, client contacts and the company's rules, saved for offline logs. */
const fieldDailyLogFollowUpSetupSchema = z.object({
  rules: z.object({
    todoMode: z.enum(DAILY_LOG_TODO_MODES),
    todoTypes: z.array(z.enum(DAILY_LOG_TODO_TYPES)),
    workedMovesToInProgress: z.boolean(),
    carryBlocked: z.boolean(),
    todoCostCodes: z.boolean(),
    tickAddsLine: z.boolean(),
    crewPicksCostCode: z.boolean(),
    clientContact: z.boolean(),
    clientContactSuggest: z.boolean(),
    minimumSummaryCharacters: z.number(),
  }),
  openTodos: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.enum(["open", "in_progress", "blocked"]),
      recordType: z.string(),
      assigneeName: z.string().nullable(),
      companyName: z.string().nullable(),
      costCode: z.string().nullable(),
      changedOn: z.string(),
    }),
  ),
  clientContacts: z.array(z.object({ id: z.string(), name: z.string(), role: z.string().nullable() })),
  assignees: z.array(z.object({ name: z.string(), kind: z.enum(DAILY_LOG_TODO_TYPES) })),
})

/** Cost codes and required fields, saved with the project for offline logs. */
const fieldDailyLogFormSchema = z.object({
  costCodes: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      label: z.string(),
      group: z.string(),
    }),
  ),
  requirements: z.object({
    requireCostCodeTime: z.boolean(),
    requiredFields: z.array(z.enum(DAILY_LOG_OPTIONAL_FIELDS)),
  }),
  /** Null in packets saved before logs tied into to-dos. */
  followUps: fieldDailyLogFollowUpSetupSchema.nullable().default(null),
})

/** A company machine as Field Mode keeps it for offline logging. */
const fieldMachineSchema = z.object({
  id: z.string(),
  name: z.string(),
  rateLabel: z.string().nullable(),
  runningRateCents: z.number().nullable(),
  standbyRateCents: z.number().nullable(),
  idleRateCents: z.number().nullable(),
  hourMeter: z.number().nullable(),
  services: z.array(z.object({ id: z.string(), name: z.string(), dueLabel: z.string(), state: z.enum(["ok", "soon", "due"]) })),
})

export const fieldMachineLogDraftSchema = z.object({
  kind: z.enum(MACHINE_LOG_KINDS),
  machineId: z.string().max(80),
  entryDate: z.string().max(10),
  projectId: z.string().max(80),
  operatorName: z.string().max(120),
  costCode: z.string().max(20),
  runningHours: z.string().max(12),
  standbyHours: z.string().max(12),
  idleHours: z.string().max(12),
  hourMeter: z.string().max(12),
  gallons: z.string().max(12),
  amount: z.string().max(16),
  vendor: z.string().max(120),
  paidWith: z.string().max(40),
  serviceItemId: z.string().max(80),
  shopHours: z.string().max(12),
  notes: z.string().max(4000),
})

export const fieldProjectPacketSchema = z.object({
  project: fieldProjectSchema,
  tasks: z.array(fieldTaskSchema),
  logs: z.array(fieldLogSchema),
  documents: z.array(fieldDocumentSchema),
  channel: fieldChannelSchema.nullable(),
  messages: z.array(fieldMessageSchema),
  directConversations: z.array(fieldDirectConversationSchema).default([]),
  contacts: z.array(fieldContactSchema).default([]),
  notifications: z.array(fieldNotificationSchema).default([]),
  /** Null in packets saved before cost code lines. */
  dailyLogForm: fieldDailyLogFormSchema.nullable().default(null),
  /** Company machines for the machine log; empty in older packets. */
  machines: z.array(fieldMachineSchema).default([]),
  syncedAt: z.string(),
})

const fieldWorkLineSchema = z.object({
  costCode: z.string().max(20),
  hours: z.string().max(10),
  description: z.string().max(500),
  todoId: z.string().max(80).optional(),
})

/** To-dos ticked or created and client contact recorded with a log. */
const fieldDailyLogFollowUpsSchema = z.object({
  todoUpdates: z.array(z.object({
    todoId: z.string().max(80),
    worked: z.boolean(),
    blocked: z.enum(["still", "cleared"]).nullable(),
  })).max(100),
  newTodos: z.array(z.object({
    source: z.enum(["issues", "notes"]),
    title: z.string().max(200),
    recordType: z.enum(DAILY_LOG_TODO_TYPES),
    assigneeName: z.string().max(200),
    costCode: z.string().max(20),
  })).max(40),
  clientContacts: z.array(z.object({
    contactId: z.string().max(80),
    interactionType: z.string().max(80),
    direction: z.enum(["inbound", "outbound"]),
    time: z.string().max(5),
    summary: z.string().max(4000),
    followUpTodo: z.boolean(),
  })).max(10),
})

export const fieldDailyLogDraftSchema = z.object({
  logDate: z.string(),
  workCompleted: z.string(),
  issues: z.string(),
  crewPresent: z.string(),
  notes: z.string(),
  // Added with cost code lines; logs queued by older builds lack them.
  materialsUsed: z.string().default(""),
  safetyIncidents: z.string().default(""),
  visitorLog: z.string().default(""),
  workLines: z.array(fieldWorkLineSchema).max(40).optional(),
  // Added when logs tied into to-dos; logs queued by older builds lack it.
  followUps: fieldDailyLogFollowUpsSchema.optional(),
})

const fieldQueuedAttachmentSchema = z.object({
  id: z.string(),
  localPath: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  fileSize: z.number(),
  capturedAt: z.string(),
})

export const cherishValueSchema = z.enum([
  "Camaraderie",
  "Honor",
  "Excellence",
  "Reliability",
  "Integrity",
  "Servitude",
  "Humility",
])

export const cherishResponseTypeSchema = z.enum([
  "shoutout",
  "win",
  "concern",
])

export const fieldCherishRecognitionSchema = z.object({
  id: z.string(),
  cherishValue: cherishValueSchema,
  responseType: z.enum(["shoutout", "win"]),
  message: z.string(),
  isAnonymous: z.boolean().default(false),
  submittedByName: z.string().nullable(),
  audienceScope: z.enum(["company", "user"]).default("company"),
  createdAt: z.string(),
  /** Shared in the last 24 hours and not yet viewed by this person. */
  isNew: z.boolean().default(false),
})

const fieldOutboxItemSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string(),
    kind: z.literal("daily_log"),
    projectId: z.string(),
    createdAt: z.string(),
    payload: fieldDailyLogDraftSchema,
    remoteDailyLogId: z.string().nullable().default(null),
    attachments: z.array(fieldQueuedAttachmentSchema).default([]),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("chat_message"),
    projectId: z.string(),
    createdAt: z.string(),
    payload: z.object({
      channelId: z.string(),
      content: z.string(),
    }),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("machine_log"),
    createdAt: z.string(),
    payload: fieldMachineLogDraftSchema,
  }),
  z.object({
    id: z.string(),
    kind: z.literal("cherish_pulse"),
    cherishValue: cherishValueSchema,
    responseType: cherishResponseTypeSchema,
    message: z.string().trim().min(3).max(1_200),
    anonymous: z.boolean().default(false),
    createdAt: z.string(),
  }),
])

export const fieldOutboxSchema = z.array(fieldOutboxItemSchema)

export type FieldProject = z.infer<typeof fieldProjectSchema>
export type FieldDocument = z.infer<typeof fieldDocumentSchema>
export type FieldUserProfile = z.infer<typeof fieldUserProfileSchema>
export type FieldProjectPacket = z.infer<typeof fieldProjectPacketSchema>
export type FieldDailyLogDraft = z.infer<typeof fieldDailyLogDraftSchema>
export type FieldDailyLogForm = z.infer<typeof fieldDailyLogFormSchema>
export type FieldDailyLogFollowUpSetup = z.infer<typeof fieldDailyLogFollowUpSetupSchema>
export type FieldMachine = z.infer<typeof fieldMachineSchema>
export type FieldQueuedAttachment = z.infer<typeof fieldQueuedAttachmentSchema>
export type FieldOutboxItem = z.infer<typeof fieldOutboxItemSchema>
export type FieldCherishValue = z.infer<typeof cherishValueSchema>
export type FieldCherishResponseType = z.infer<
  typeof cherishResponseTypeSchema
>
export type FieldCherishRecognition = z.infer<
  typeof fieldCherishRecognitionSchema
>
