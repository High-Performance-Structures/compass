import { z } from "zod/v4"

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

export const fieldTaskSchema = z.object({
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

export const fieldLogSchema = z.object({
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

export const fieldChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export const fieldContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
})

export const fieldMessageSchema = z.object({
  id: z.string(),
  content: z.string(),
  createdAt: z.string(),
  userName: z.string(),
})

export const fieldDirectConversationSchema = z.object({
  id: z.string(),
  name: z.string(),
  unreadCount: z.number(),
  messages: z.array(fieldMessageSchema),
})

export const fieldNotificationSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  href: z.string(),
  projectId: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
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
  syncedAt: z.string(),
})

export const fieldDailyLogDraftSchema = z.object({
  logDate: z.string(),
  workCompleted: z.string(),
  issues: z.string(),
  crewPresent: z.string(),
  notes: z.string(),
})

export const fieldQueuedAttachmentSchema = z.object({
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
  submittedByName: z.string().nullable(),
  createdAt: z.string(),
})

export const fieldOutboxItemSchema = z.discriminatedUnion("kind", [
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
    kind: z.literal("cherish_pulse"),
    cherishValue: cherishValueSchema,
    responseType: cherishResponseTypeSchema,
    message: z.string().trim().min(3).max(1_200),
    createdAt: z.string(),
  }),
])

export const fieldOutboxSchema = z.array(fieldOutboxItemSchema)

export type FieldProject = z.infer<typeof fieldProjectSchema>
export type FieldDocument = z.infer<typeof fieldDocumentSchema>
export type FieldContact = z.infer<typeof fieldContactSchema>
export type FieldUserProfile = z.infer<typeof fieldUserProfileSchema>
export type FieldProjectPacket = z.infer<typeof fieldProjectPacketSchema>
export type FieldNotification = z.infer<typeof fieldNotificationSchema>
export type FieldDailyLogDraft = z.infer<typeof fieldDailyLogDraftSchema>
export type FieldQueuedAttachment = z.infer<typeof fieldQueuedAttachmentSchema>
export type FieldOutboxItem = z.infer<typeof fieldOutboxItemSchema>
export type FieldCherishValue = z.infer<typeof cherishValueSchema>
export type FieldCherishResponseType = z.infer<
  typeof cherishResponseTypeSchema
>
export type FieldCherishRecognition = z.infer<
  typeof fieldCherishRecognitionSchema
>
