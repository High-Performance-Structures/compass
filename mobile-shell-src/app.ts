import { App } from "@capacitor/app"
import { Browser } from "@capacitor/browser"
import { Capacitor, CapacitorHttp } from "@capacitor/core"
import { FileViewer } from "@capacitor/file-viewer"
import { Directory, Filesystem } from "@capacitor/filesystem"
import { Keyboard, KeyboardResize } from "@capacitor/keyboard"
import { Network } from "@capacitor/network"
import { Preferences } from "@capacitor/preferences"
import { PushNotifications } from "@capacitor/push-notifications"
import { NativeBiometric } from "@capgo/capacitor-native-biometric"
import { z } from "zod/v4"

import {
  cherishResponseTypeSchema,
  cherishValueSchema,
  fieldOutboxSchema,
  fieldDocumentSchema,
  fieldProjectPacketSchema,
  fieldProjectSchema,
  fieldUserProfileSchema,
  type FieldOutboxItem,
  type FieldCherishResponseType,
  type FieldCherishValue,
  type FieldDocument,
  type FieldProject,
  type FieldProjectPacket,
  type FieldQueuedAttachment,
  type FieldUserProfile,
} from "../src/lib/field/types"
import { isTaskAssignedToFieldUser } from "../src/lib/field/task-assignment"
import { drainDailyLogOutbox } from "../src/lib/field/daily-log-outbox"
import { conversationChannelIdFromNotificationHref } from "../src/lib/conversations/notification-route"
import { isFieldAppUrl, resolveDashboardAppUrl } from "./app-url"
import {
  appendOptimisticDirectMessage,
  PROJECT_CONVERSATION_KEY,
  pushNotificationHref,
  resolveConversationSelection,
} from "./conversation-state"
import {
  filterFieldProjects,
  isProjectCompanyFilter,
  PROJECT_COMPANY_OPTIONS,
  projectCompanyLabel,
  type ProjectCompanyFilter,
} from "./project-picker"

const LIVE_URL = "https://compass.openrangeconstruction.ltd"
const PROJECTS_KEY = "compass_field_projects_v1"
const ACTIVE_PROJECT_KEY = "compass_field_active_project_v1"
const OUTBOX_KEY = "compass_field_outbox_v1"
const PACKET_PREFIX = "compass_field_packet_v1"
const DOCUMENTS_KEY = "compass_field_documents_v1"
const AUTH_STATE_KEY = "compass_native_auth_state_v1"
const AUTH_VERIFIER_KEY = "compass_native_auth_verifier_v1"
const PROFILE_KEY = "compass_field_profile_v1"
const BIOMETRIC_ENABLED_KEY = "compass_biometric_enabled"
const FIELD_ATTACHMENT_DIRECTORY = "compass-field-attachments"
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
const BACKGROUND_LOCK_THRESHOLD_MS = 30_000
const isIos = Capacitor.getPlatform() === "ios"

type Project = FieldProject
type Packet = FieldProjectPacket
type QueuedItem = FieldOutboxItem
type SavedDocument = {
  readonly projectId: string
  readonly fileId: string
  readonly name: string
  readonly mimeType: string
  readonly path: string
  readonly savedAt: string
}
type Tab = "projects" | "today" | "log" | "documents" | "chat" | "notifications" | "cherish" | "settings"
type AuthMode = "choice" | "password" | "email" | "code"
type PushStatus = "checking" | "enabled" | "permission_required" | "denied" | "error"

const savedDocumentSchema = z.object({
  projectId: z.string(),
  fileId: z.string(),
  name: z.string(),
  mimeType: z.string(),
  path: z.string(),
  savedAt: z.string(),
})
const savedDocumentsSchema = z.array(savedDocumentSchema)
const projectsSchema = z.array(fieldProjectSchema)
const nativeAuthResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  redirectUrl: z.string().optional(),
})
const nativeFieldBootstrapResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  profile: fieldUserProfileSchema.optional(),
  projects: projectsSchema.optional(),
  initialPacket: fieldProjectPacketSchema.nullable().optional(),
})
const nativeFieldFolderResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  folder: z.object({ id: z.string(), name: z.string() }).optional(),
  documents: z.array(fieldDocumentSchema).optional(),
})

const app = document.querySelector<HTMLDivElement>("#app")
let projects: Project[] = []
let packet: Packet | null = null
let profile: FieldUserProfile | null = null
let outbox: QueuedItem[] = []
let documents: SavedDocument[] = []
let activeTab: Tab = "today"
let online = false
let authError = ""
let signingIn = false
let authMode: AuthMode = "choice"
let authEmail = ""
let draftAttachments: FieldQueuedAttachment[] = []
let attachmentError = ""
let syncingDailyLogs = false
let projectError = ""
let syncing = false
let messageActionError = ""
let directMessageStatus = ""
let startingConversation = false
let refreshingProject = false
let directRecipientId = ""
let directMessageDraft = ""
let projectMessageDraft = ""
let openDirectChannelId: string | null = null
const directReplyDrafts: Record<string, string> = {}
let lastProjectRefreshAt = 0
let pushStatus: PushStatus = "checking"
let pushToken: string | null = null
let pushSetupStarted = false
let cherishValue: FieldCherishValue = "Reliability"
let cherishResponseType: FieldCherishResponseType = "shoutout"
let cherishMessage = ""
let cherishFeedback = ""
let syncingCherish = false
let biometricEnabled = false
let biometricLocked = false
let backgroundedAt: number | null = null
let pendingAppUrl: string | null = null
let projectCompanyFilter: ProjectCompanyFilter = "all"
let projectSearch = ""
let downloadingDocumentId = ""
let documentActionError = ""
let loadingDocumentFolderId = ""
let documentFolderStack: {
  readonly id: string
  readonly name: string
  readonly documents: readonly FieldDocument[]
}[] = []

function bellIcon(): string {
  return `<svg class="header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.268 21a2 2 0 0 0 3.464 0"></path><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"></path></svg>`
}

function syncIcon(): string {
  return `<svg class="header-icon ${syncing ? "spin" : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path><path d="M8 16H3v5"></path></svg>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }
    return entities[character] ?? character
  })
}

function shortDate(value: string): string {
  if (!value) return ""
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)
}

function packetKey(projectId: string): string { return `${PACKET_PREFIX}.${projectId}` }

async function readJson(key: string): Promise<unknown> {
  const result = await Preferences.get({ key })
  if (!result.value) return null
  try { return JSON.parse(result.value) } catch { return null }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await Preferences.set({ key, value: JSON.stringify(value) })
}

function projectLabel(project: Project): string {
  return project.projectNumber ? `${project.projectNumber} - ${project.name}` : project.name
}

function filteredProjectList(): readonly Project[] {
  return filterFieldProjects(projects, projectCompanyFilter, projectSearch)
}

function projectPickerResults(): string {
  const filteredProjects = filteredProjectList()
  const hasFilter = projectCompanyFilter !== "all" || projectSearch.trim().length > 0
  const summary = filteredProjects.length === projects.length
    ? `${projects.length} projects`
    : `${filteredProjects.length} of ${projects.length} projects`
  const clearButton = hasFilter
    ? `<button id="clear-project-filters" class="project-clear" type="button">Clear filters</button>`
    : ""

  if (filteredProjects.length === 0) {
    return `<div class="project-result-summary"><span>${escapeHtml(summary)}</span>${clearButton}</div><div class="empty project-empty">No projects match that company and search.</div>`
  }

  return `<div class="project-result-summary"><span>${escapeHtml(summary)}</span>${clearButton}</div><div class="rows project-results">${filteredProjects.map((project) => `
    <button class="row project-row" data-project-id="${escapeHtml(project.id)}" type="button">
      <div class="row-main"><div class="project-row-heading"><p class="row-title">${escapeHtml(projectLabel(project))}</p><span class="project-company-badge">${escapeHtml(projectCompanyLabel(project))}</span></div><p class="row-note">${escapeHtml(project.address ?? "")}</p></div>
      <strong>${packet?.project.id === project.id ? "Selected" : "Open"}</strong>
    </button>`).join("")}</div>`
}

function projectCompanyOptions(): string {
  return PROJECT_COMPANY_OPTIONS.map((option) => {
    const count = projects.filter((project) => projectCompanyLabel(project) === option.label).length
    const selected = projectCompanyFilter === option.value ? " selected" : ""
    return `<option value="${option.value}"${selected}>${escapeHtml(option.label)} (${count})</option>`
  }).join("")
}

function sectionHead(title: string, note = ""): string {
  return `<div class="section-head"><h2>${escapeHtml(title)}</h2>${note ? `<p>${escapeHtml(note)}</p>` : ""}</div>`
}

function empty(text: string): string { return `<div class="empty">${escapeHtml(text)}</div>` }

function projectsView(): string {
  if (projects.length === 0) {
    if (profile) {
      return sectionHead("Active projects") + `<div class="empty auth-empty"><p>No active projects are assigned to your Compass account yet.</p><div class="auth-actions"><button id="open-live-empty" class="secondary auth-button" type="button" ${online ? "" : "disabled"}>Open Full Compass</button></div></div>`
    }
    if (authMode === "password") {
      return sectionHead("Sign in to Field Mode", "Use the email address and password connected to your Compass account.") + `<form id="native-password-form" class="form auth-form"><label class="field">Email address<input name="email" type="email" autocomplete="email" inputmode="email" value="${escapeHtml(authEmail)}" required /></label><label class="field">Password<input name="password" type="password" autocomplete="current-password" required /></label>${authError ? `<p class="auth-error" role="alert">${escapeHtml(authError)}</p>` : ""}<button class="primary" type="submit" ${signingIn ? "disabled" : ""}>${signingIn ? "Signing in" : "Sign in"}</button><button class="text-button" id="native-reset-password" type="button" ${online && !signingIn ? "" : "disabled"}>Forgot or need a password?</button><button class="text-button" data-auth-choice type="button" ${signingIn ? "disabled" : ""}>Back to sign-in choices</button></form>`
    }
    if (authMode === "email") {
      return sectionHead("Sign in to Field Mode", "Use the email address connected to your Compass account.") + `<form id="native-email-form" class="form auth-form"><label class="field">Email address<input name="email" type="email" autocomplete="email" inputmode="email" value="${escapeHtml(authEmail)}" required /></label>${authError ? `<p class="auth-error" role="alert">${escapeHtml(authError)}</p>` : ""}<button class="primary" type="submit" ${signingIn ? "disabled" : ""}>${signingIn ? "Sending code" : "Send verification code"}</button><button class="text-button" data-auth-choice type="button" ${signingIn ? "disabled" : ""}>Back to sign-in choices</button></form>`
    }
    if (authMode === "code") {
      return sectionHead("Enter your verification code", `We sent a six-digit code to ${authEmail}.`) + `<form id="native-code-form" class="form auth-form"><label class="field">Verification code<input name="code" type="text" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required /></label>${authError ? `<p class="auth-error" role="alert">${escapeHtml(authError)}</p>` : ""}<button class="primary" type="submit" ${signingIn ? "disabled" : ""}>${signingIn ? "Verifying" : "Verify and open Compass"}</button><button class="text-button" data-auth-email type="button" ${signingIn ? "disabled" : ""}>Use a different email</button></form>`
    }
    const message = authError
      ? `<p class="auth-error" role="alert">${escapeHtml(authError)}</p>`
      : `<p>Sign in once while connected to download your assigned projects.</p>`
    const googleSignIn = isIos
      ? `<p class="auth-note">Google sign-in is temporarily unavailable in the iPhone app. Use your Compass email and password.</p>`
      : `<button id="native-sign-in" class="secondary auth-button" type="button" ${online && !signingIn ? "" : "disabled"}>${signingIn ? "Opening secure sign in" : "Sign in with Google"}</button>`
    return sectionHead("Active projects") + `<div class="empty auth-empty">${message}<div class="auth-actions"><button id="password-sign-in" class="primary auth-button" type="button" ${online && !signingIn ? "" : "disabled"}>Sign in with email and password</button>${googleSignIn}</div></div>`
  }
  return sectionHead("Active projects", "Filter by department or type any part of a project to find it fast.") + `${projectError ? `<p class="auth-error" role="alert">${escapeHtml(projectError)}</p>` : ""}<div class="project-picker">
    <label class="field">Department<select id="project-company-filter"><option value="all"${projectCompanyFilter === "all" ? " selected" : ""}>All departments (${projects.length})</option>${projectCompanyOptions()}</select></label>
    <label class="field">Find a project<input id="project-search" type="search" inputmode="search" autocomplete="off" spellcheck="false" aria-controls="project-picker-results" placeholder="Number, name, or address" value="${escapeHtml(projectSearch)}" /></label>
    <div id="project-picker-results" aria-live="polite">${projectPickerResults()}</div>
  </div>`
}

function todayView(): string {
  if (!packet) return empty("Select a project to begin.")
  const today = new Date().toISOString().slice(0, 10)
  const open = packet.tasks.filter((task) => !["COMPLETE", "complete", "closed", "cancelled"].includes(task.status))
  const assigned = open
    .filter(
      (task) =>
        task.kind === "task" &&
        profile !== null &&
        isTaskAssignedToFieldUser(task.assignedTo, {
          email: profile.email,
          displayName: profile.name,
          firstName: null,
          lastName: null,
        })
    )
    .slice(0, 12)
  const schedule = open.filter((task) => task.kind === "schedule" && task.endDate >= today).sort((left, right) => left.startDate.localeCompare(right.startDate)).slice(0, 14)
  const assignedRows = assigned.length ? `<div class="rows">${assigned.map((task) => `<div class="row"><div class="row-main"><p class="row-title">${escapeHtml(task.title)}</p><p class="row-note">${escapeHtml(task.assignedTo ?? task.description ?? "Assigned task")}</p></div><span class="row-date">${escapeHtml(shortDate(task.endDate))}</span></div>`).join("")}</div>` : empty("No open tasks are assigned to you for this project.")
  const scheduleRows = schedule.length ? `<div class="rows">${schedule.map((task) => `<div class="row"><span class="row-date">${escapeHtml(shortDate(task.startDate))}</span><div class="row-main"><p class="row-title">${escapeHtml(task.title)}</p><p class="row-note">${escapeHtml(task.phase)} - ${task.percentComplete}%</p></div></div>`).join("")}</div>` : empty("No upcoming schedule items.")
  return sectionHead("My tasks", "Assigned work for this job.") + assignedRows + `<div class="block">${sectionHead("Project schedule")}${scheduleRows}</div>`
}

function logView(): string {
  if (!packet) return empty("Select a project to add a daily log.")
  const today = new Date().toISOString().slice(0, 10)
  const recent = packet.logs.slice(0, 6).map((log) => `<div class="row"><span class="row-date">${escapeHtml(shortDate(log.logDate))}</span><div class="row-main"><p class="row-title">${escapeHtml(log.workCompleted)}</p><p class="row-note">${escapeHtml(log.authorName ?? "Compass")}</p></div></div>`).join("")
  const attachmentRows = draftAttachments.map((attachment) => `<div class="attachment-row"><div><strong>${escapeHtml(attachment.fileName)}</strong><span>${escapeHtml(formatBytes(attachment.fileSize))}</span></div><button type="button" data-remove-attachment="${escapeHtml(attachment.id)}" aria-label="Remove ${escapeHtml(attachment.fileName)}">Remove</button></div>`).join("")
  return sectionHead("Add daily log", "Saved securely on this device until Compass can sync.") + `
    <form id="daily-log-form" class="form">
      <label class="field">Date<input name="logDate" type="date" value="${today}" required /></label>
      <label class="field">What did we complete?<textarea name="workCompleted" required placeholder="Describe today's work"></textarea></label>
      <label class="field">Who was on site?<input name="crewPresent" placeholder="Crew, subs, suppliers" /></label>
      <label class="field">Issues or delays<textarea name="issues" placeholder="Leave blank if none"></textarea></label>
      <label class="field">Notes<textarea name="notes"></textarea></label>
      <label class="file-picker" for="daily-log-attachments"><strong>Add photos, videos, or files</strong><span>Choose from the camera, photo library, or Files app</span></label>
      <input id="daily-log-attachments" class="native-file-input" type="file" multiple accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" />
      ${attachmentError ? `<p class="attachment-error" role="alert">${escapeHtml(attachmentError)}</p>` : ""}
      ${attachmentRows ? `<div class="attachment-list">${attachmentRows}</div>` : ""}
      <button class="primary" type="submit">Save for sync</button>
    </form>
    <div class="block">${sectionHead("Recent logs")}${recent ? `<div class="rows">${recent}</div>` : empty("No cached daily logs.")}</div>`
}

function documentsView(): string {
  if (!packet) return empty("Select a project to view documents.")
  const currentFolder = documentFolderStack.at(-1) ?? null
  const visibleDocuments = currentFolder?.documents ?? packet.documents
  const projectDocuments = documents.filter((item) => item.projectId === packet?.project.id)
  const savedIds = new Set(projectDocuments.map((item) => item.fileId))
  const rootIds = new Set(packet.documents.map((document) => document.id))
  const rows = visibleDocuments.map((document) => {
    const saved = savedIds.has(document.id)
    const canOpen = saved || online
    const downloading = downloadingDocumentId === document.id
    const loadingFolder = loadingDocumentFolderId === document.id
    const note = saved
      ? "Available offline"
      : document.type === "folder"
        ? online ? "Browse the files in this folder" : "Folder requires a connection"
        : downloading ? "Saving securely on this device" : online ? "Tap to download for offline use" : "Not downloaded"
    const action = loadingFolder ? "Opening…" : downloading ? "Saving…" : saved ? "Open" : online ? document.type === "folder" ? "Browse" : "Download" : ""
    return `<button class="row document-row" data-file-id="${escapeHtml(document.id)}" ${canOpen && !downloading && !loadingFolder ? "" : "disabled"}><div class="row-main"><p class="row-title">${escapeHtml(document.name)}</p><p class="row-note">${escapeHtml(note)}</p></div><strong>${action}</strong></button>`
  }).join("")
  const nestedRows = projectDocuments
    .filter((document) => !rootIds.has(document.fileId))
    .map((document) => `<button class="row document-row" data-file-id="${escapeHtml(document.fileId)}"><div class="row-main"><p class="row-title">${escapeHtml(document.name)}</p><p class="row-note">Available offline</p></div><strong>Open</strong></button>`)
    .join("")
  const savedFromFolders = nestedRows && !currentFolder
    ? `<div class="block">${sectionHead("Saved from folders", "Downloaded files available without service.")}<div class="rows">${nestedRows}</div></div>`
    : ""
  const folderNavigation = currentFolder
    ? `<div class="document-folder-nav"><button id="document-folder-back" class="secondary" type="button">← Back</button><div><span>Current folder</span><strong>${escapeHtml(currentFolder.name)}</strong></div></div>`
    : ""
  return sectionHead(currentFolder?.name ?? "Construction documents", currentFolder ? "Browse or save a file without leaving Field Mode." : "Only files marked available offline can open without service.") + folderNavigation + (documentActionError ? `<p class="auth-error" role="alert">${escapeHtml(documentActionError)}</p>` : "") + (rows ? `<div class="rows">${rows}</div>` : empty(currentFolder ? "This folder is empty." : "No cached project documents.")) + savedFromFolders
}

function newDirectMessageView(): string {
  if (!packet) return ""
  const options = packet.contacts
    .map(
      (contact) =>
        `<option value="${escapeHtml(contact.id)}" ${contact.id === directRecipientId ? "selected" : ""}>${escapeHtml(contact.name)} - ${escapeHtml(contact.role)}</option>`
    )
    .join("")

  return `<details class="message-tools" ${packet.channel || packet.directConversations.length > 0 ? "" : "open"}>
    <summary>New direct message</summary>
    <form id="direct-message-form" class="direct-message-form">
      ${packet.contacts.length > 0
        ? `<label class="field">To<select name="targetUserId" required><option value="">Choose office or field staff</option>${options}</select></label>
          <label class="field">Message<textarea name="content" required placeholder="Write a direct message">${escapeHtml(directMessageDraft)}</textarea></label>
          <div class="keyboard-toolbar"><span>Direct message</span><button data-keyboard-done type="button">Done</button></div>
          <button class="secondary" type="submit" ${online && !startingConversation ? "" : "disabled"}>${startingConversation ? "Sending..." : "Send direct message"}</button>`
        : `<p class="message-help">${online ? "The staff directory has not loaded yet." : "Connect to load the staff directory."}</p>
          <button id="refresh-project-messages" class="secondary" type="button" ${online && !refreshingProject ? "" : "disabled"}>${refreshingProject ? "Loading staff..." : "Load staff directory"}</button>`}
      ${!online ? `<p class="message-help">Connect to start a new direct conversation.</p>` : ""}
      ${directMessageStatus ? `<p class="message-success" role="status">${escapeHtml(directMessageStatus)}</p>` : ""}
      ${messageActionError ? `<p class="attachment-error" role="alert">${escapeHtml(messageActionError)}</p>` : ""}
    </form>
  </details>`
}

function conversationPickerView(selectedConversationId: string | null): string {
  if (!packet || !selectedConversationId) return ""
  const unreadCount = packet.directConversations.reduce(
    (total, conversation) => total + conversation.unreadCount,
    0
  )
  const conversationCount = packet.directConversations.length + (packet.channel ? 1 : 0)
  const projectOption = packet.channel
    ? `<optgroup label="Project group"><option value="${PROJECT_CONVERSATION_KEY}" ${selectedConversationId === PROJECT_CONVERSATION_KEY ? "selected" : ""}>${escapeHtml(packet.channel.name)}</option></optgroup>`
    : ""
  const directOptions = packet.directConversations
    .map(
      (conversation) =>
        `<option value="${escapeHtml(conversation.id)}" ${selectedConversationId === conversation.id ? "selected" : ""}>${escapeHtml(conversation.name)}${conversation.unreadCount > 0 ? ` (${conversation.unreadCount} new)` : ""}</option>`
    )
    .join("")
  const directGroup = directOptions
    ? `<optgroup label="Direct messages">${directOptions}</optgroup>`
    : ""
  const unreadSummary = unreadCount > 0 ? ` · ${unreadCount} unread` : ""

  return `<div class="conversation-picker"><label class="field">Conversation
    <select id="message-conversation" aria-label="Choose a conversation">${projectOption}${directGroup}</select>
    <span class="conversation-count">${conversationCount} conversation${conversationCount === 1 ? "" : "s"}${unreadSummary}</span>
  </label></div>`
}

function activeDirectConversationView(channelId: string): string {
  if (!packet) return ""
  const conversation = packet.directConversations.find(
    (candidate) => candidate.id === channelId
  )
  if (!conversation) return ""
  const messageRows = conversation.messages
    .slice(-12)
    .map(
      (message) =>
        `<div class="message"><div class="message-meta"><span class="message-author">${escapeHtml(message.userName)}</span><span class="message-time">${escapeHtml(shortDate(message.createdAt))}</span></div><p class="message-body">${escapeHtml(message.content)}</p></div>`
    )
    .join("")

  return `<section class="active-conversation" aria-label="Direct conversation with ${escapeHtml(conversation.name)}">
    <div class="active-conversation-head"><h2>${escapeHtml(conversation.name)}</h2><span>Direct message</span></div>
    <div class="direct-thread-messages">${messageRows || empty("No messages in this conversation.")}</div>
    <form class="direct-reply-form" data-direct-channel-id="${escapeHtml(conversation.id)}">
      <div class="keyboard-toolbar"><span>Private reply</span><button data-keyboard-done type="button">Done</button></div>
      <textarea name="content" required placeholder="Reply privately">${escapeHtml(directReplyDrafts[conversation.id] ?? "")}</textarea>
      <button class="primary" type="submit">${online ? "Send reply" : "Save reply for sync"}</button>
    </form>
  </section>`
}

function messagesView(): string {
  if (!packet) return empty("Select a project to view messages.")
  const selectedConversationId = resolveConversationSelection(
    packet,
    openDirectChannelId
  )
  const picker = conversationPickerView(selectedConversationId)
  const newDirectMessage = newDirectMessageView()
  if (
    selectedConversationId &&
    selectedConversationId !== PROJECT_CONVERSATION_KEY
  ) {
    return `${picker}${activeDirectConversationView(selectedConversationId)}${newDirectMessage}`
  }
  if (!packet.channel) {
    return `${sectionHead("Project messages", "Start a team channel for this job or message a staff member directly.")}
      <div class="message-start">
        <button id="start-project-channel" class="primary" type="button" ${online && !startingConversation ? "" : "disabled"}>${startingConversation ? "Starting channel..." : "Start project channel"}</button>
        ${!online ? `<p class="message-help">Connect once to create the channel. Existing cached conversations remain available offline.</p>` : ""}
        ${messageActionError ? `<p class="attachment-error" role="alert">${escapeHtml(messageActionError)}</p>` : ""}
      </div>${newDirectMessage}`
  }
  const messages = packet.messages.map((message) => `<div class="message"><div class="message-meta"><span class="message-author">${escapeHtml(message.userName)}</span><span class="message-time">${escapeHtml(shortDate(message.createdAt))}</span></div><p class="message-body">${escapeHtml(message.content)}</p></div>`).join("")
  return picker + sectionHead(packet.channel.name, "Project messages") + `<div class="chat-list">${messages || empty("No cached messages.")}</div><details class="project-message-tools"><summary>Message the project team</summary><form id="chat-form" class="chat-compose"><div class="keyboard-toolbar"><span>Project team message</span><button data-keyboard-done type="button">Done</button></div><textarea name="content" required placeholder="Message the project team">${escapeHtml(projectMessageDraft)}</textarea><button class="primary" type="submit">${online ? "Send message" : "Save message for sync"}</button></form></details>${newDirectMessage}`
}

function notificationsView(): string {
  if (!packet) return empty("Open a project online once to load notifications.")
  const rows = packet.notifications.map((notification) => `
    <button class="row notification-row" data-notification-id="${escapeHtml(notification.id)}" data-notification-href="${escapeHtml(notification.href)}" data-notification-project-id="${escapeHtml(notification.projectId ?? "")}">
      <div class="row-main">
        <p class="row-title">${escapeHtml(notification.title)}</p>
        <p class="row-note">${escapeHtml(notification.body)}</p>
      </div>
      <span class="notification-state">${notification.readAt ? "Open" : "New"}</span>
    </button>`).join("")
  return sectionHead("Notifications", "Messages and project activity needing your attention.") + (rows ? `<div class="rows">${rows}</div>` : empty("No notifications."))
}

function cherishView(): string {
  const valueOptions = cherishValueSchema.options
    .map(
      (value) =>
        `<option value="${value}" ${value === cherishValue ? "selected" : ""}>${value}</option>`
    )
    .join("")
  const responseOptions: readonly {
    readonly value: FieldCherishResponseType
    readonly label: string
  }[] = [
    { value: "shoutout", label: "Shoutout" },
    { value: "win", label: "Project win" },
    { value: "concern", label: "Private concern" },
  ]

  return `${sectionHead("CHERISH feedback", "Save a shoutout, project win, or private concern without leaving Field Mode.")}
    <form id="cherish-form" class="form">
      <label class="field">CHERISH value
        <select name="cherishValue" required>${valueOptions}</select>
      </label>
      <label class="field">Response type
        <select name="responseType" required>${responseOptions.map((option) => `<option value="${option.value}" ${option.value === cherishResponseType ? "selected" : ""}>${option.label}</option>`).join("")}</select>
      </label>
      <label class="field">What would you like to share?
        <textarea name="message" minlength="3" maxlength="1200" required placeholder="Add a little detail">${escapeHtml(cherishMessage)}</textarea>
      </label>
      ${cherishFeedback ? `<p class="${cherishFeedback.startsWith("Saved") || cherishFeedback.startsWith("Synced") ? "message-success" : "attachment-error"}" role="status">${escapeHtml(cherishFeedback)}</p>` : ""}
      <button class="primary" type="submit" ${syncingCherish ? "disabled" : ""}>${syncingCherish ? "Syncing" : online ? "Save and sync" : "Save for sync"}</button>
    </form>`
}

function settingsView(): string {
  const profileRows = profile
    ? `<dl class="profile-list"><div><dt>Name</dt><dd>${escapeHtml(profile.name)}</dd></div><div><dt>Email</dt><dd>${escapeHtml(profile.email)}</dd></div><div><dt>Role</dt><dd>${escapeHtml(profile.role)}</dd></div><div><dt>Project</dt><dd>${escapeHtml(packet?.project.name ?? "None selected")}</dd></div><div><dt>Sync</dt><dd>${online ? "Online" : "Offline"} - ${outbox.length === 0 ? "Up to date" : `${outbox.length} waiting`}</dd></div></dl>`
    : `<p class="notice">Open Compass once while connected to cache your profile.</p>`
  const pushDescription = pushStatus === "enabled"
    ? "Enabled — Compass can alert this device to new direct messages."
    : pushStatus === "denied"
      ? "Off in iPhone or Android Settings. Open Settings, choose Compass, then allow notifications."
      : pushStatus === "permission_required"
        ? "Permission is still needed on this device."
        : pushStatus === "error"
          ? "Compass could not finish notification setup. Try again while connected."
          : "Checking notification permission on this device."
  const pushButton = pushStatus === "enabled" || pushStatus === "checking"
    ? ""
    : `<button id="enable-push" class="secondary" type="button">Try notification setup again</button>`
  return `${sectionHead("Field settings", "Profile and offline readiness")}${profileRows}<div class="block">${sectionHead("iPhone and Android notifications")}<div class="guide-copy"><p>${escapeHtml(pushDescription)}</p>${pushButton}</div></div><div class="block">${sectionHead("Before working offline")}<ol class="guide-list"><li>While connected, open every project you expect to use.</li><li>Refresh each project so tasks, schedule items, logs, and messages are current.</li><li>Save the plans and files you need from Documents.</li><li>Confirm the header shows no items waiting to sync.</li></ol></div><div class="block">${sectionHead("How offline sync works")}<div class="guide-copy"><p>Daily logs, attachments, and project messages stay securely on this device while offline.</p><p>After service returns, keep Compass open until the waiting count reaches zero.</p><p>If a file fails partway through, Compass retries the remaining files without creating a second daily log.</p></div></div>`
}

function view(): string {
  if (activeTab === "projects") return projectsView()
  if (activeTab === "today") return todayView()
  if (activeTab === "log") return logView()
  if (activeTab === "documents") return documentsView()
  if (activeTab === "notifications") return notificationsView()
  if (activeTab === "cherish") return cherishView()
  if (activeTab === "settings") return settingsView()
  return messagesView()
}

function render(): void {
  if (!app) return
  if (biometricLocked) {
    app.innerHTML = `<main class="lock-screen"><div class="lock-mark" aria-hidden="true">C</div><h1>Compass is locked</h1><p>Use Face ID or your device fingerprint to continue.</p><button id="unlock-compass" class="primary" type="button">Unlock Compass</button><button id="unlock-with-password" class="text-button" type="button" ${online ? "" : "disabled"}>Use password</button></main>`
    document.querySelector<HTMLButtonElement>("#unlock-compass")?.addEventListener("click", () => void unlockCompass())
    document.querySelector<HTMLButtonElement>("#unlock-with-password")?.addEventListener("click", () => {
      if (online) window.location.assign(`${LIVE_URL}/login`)
    })
    return
  }
  const title = packet ? projectLabel(packet.project) : "Compass"
  const queued = outbox.length > 0 ? ` - ${outbox.length} waiting to sync` : ""
  const unreadNotifications = packet?.notifications.filter((notification) => notification.readAt === null).length ?? 0
  const tabs: { value: Tab; symbol: string; label: string }[] = [
    { value: "projects", symbol: "P", label: "Projects" },
    { value: "today", symbol: "T", label: "Today" },
    { value: "log", symbol: "L", label: "Log" },
    { value: "documents", symbol: "D", label: "Documents" },
    { value: "chat", symbol: "M", label: "Messages" },
  ]
  const liveLabel = profile ? "Full Compass" : "Sign in"
  app.innerHTML = `<div class="shell"><header class="shell-header"><div class="header-row"><div><p class="eyebrow">Field mode</p><h1 class="project-title">${escapeHtml(title)}</h1></div><div class="header-actions">${outbox.length > 0 && online ? `<button id="sync-now" class="icon-button" type="button" aria-label="Sync waiting work">${syncIcon()}</button>` : ""}<button id="field-notifications" class="notification-button" type="button" aria-label="Notifications">${bellIcon()}${unreadNotifications > 0 ? `<span>${unreadNotifications > 9 ? "9+" : unreadNotifications}</span>` : ""}</button><button id="open-cherish" class="settings-button" type="button" ${activeTab === "cherish" ? "aria-current=page" : ""}>CHERISH</button><button id="field-settings" class="settings-button" type="button" aria-label="Field settings">Settings</button><button id="open-live" class="live-button" ${online && !signingIn ? "" : "disabled"}>${liveLabel}</button></div></div><div class="sync-line"><span class="status-dot ${online ? "online" : ""}"></span>${syncing || syncingCherish || syncingDailyLogs ? "Syncing waiting work" : online ? "Connection available" : "Offline"}${escapeHtml(queued)}</div></header><main class="content">${view()}</main><nav class="tabbar">${tabs.map((tab) => `<button class="tab ${activeTab === tab.value ? "active" : ""}" data-tab="${tab.value}"><span class="tab-symbol">${tab.symbol}</span>${tab.label}</button>`).join("")}</nav></div>`
  bindEvents()
}

async function biometricPreference(): Promise<boolean | null> {
  const result = await Preferences.get({ key: BIOMETRIC_ENABLED_KEY })
  if (result.value === null) return null
  return result.value === "true"
}

async function unlockCompass(): Promise<boolean> {
  try {
    const availability = await NativeBiometric.isAvailable()
    if (!availability.isAvailable) return false
    await NativeBiometric.verifyIdentity({
      reason: "Unlock Compass",
      title: "Authentication Required",
    })
    biometricLocked = false
    backgroundedAt = null
    render()
    const destination = pendingAppUrl
    pendingAppUrl = null
    if (destination) {
      await handleAppUrl(destination)
      return true
    }
    void refreshConnectivityAndSync()
    return true
  } catch {
    biometricLocked = true
    render()
    return false
  }
}

async function lockCompassIfEnabled(): Promise<void> {
  if (!biometricEnabled) return
  biometricLocked = true
  render()
  await unlockCompass()
}

function isTab(value: string | undefined): value is Tab {
  return value === "projects" || value === "today" || value === "log" || value === "documents" || value === "chat" || value === "notifications" || value === "cherish" || value === "settings"
}

function bindEvents(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => button.addEventListener("click", () => {
    if (isTab(button.dataset.tab)) activeTab = button.dataset.tab
    render()
    if (activeTab === "chat" && online) void refreshProjectPacket()
  }))
  document.querySelectorAll<HTMLButtonElement>("[data-project-id]").forEach((button) => button.addEventListener("click", () => void selectProject(button.dataset.projectId ?? "")))
  document.querySelector("#project-company-filter")?.addEventListener("change", (event) => {
    if (!(event.currentTarget instanceof HTMLSelectElement)) return
    if (!isProjectCompanyFilter(event.currentTarget.value)) return
    projectCompanyFilter = event.currentTarget.value
    refreshProjectPickerResults()
  })
  document.querySelector<HTMLInputElement>("#project-search")?.addEventListener("input", (event) => {
    if (!(event.currentTarget instanceof HTMLInputElement)) return
    projectSearch = event.currentTarget.value
    refreshProjectPickerResults()
  })
  bindProjectPickerResultEvents()
  document.querySelectorAll<HTMLButtonElement>("[data-file-id]").forEach((button) => button.addEventListener("click", () => void openDocument(button.dataset.fileId ?? "")))
  document.querySelector<HTMLButtonElement>("#document-folder-back")?.addEventListener("click", () => {
    documentFolderStack = documentFolderStack.slice(0, -1)
    documentActionError = ""
    render()
  })
  document.querySelector<HTMLButtonElement>("#open-live")?.addEventListener("click", openFullCompass)
  document.querySelector<HTMLButtonElement>("#open-live-empty")?.addEventListener("click", openFullCompass)
  document.querySelector<HTMLButtonElement>("#open-cherish")?.addEventListener("click", openCherish)
  document.querySelector<HTMLButtonElement>("#sync-now")?.addEventListener("click", () => void resumePendingSync())
  document.querySelector<HTMLButtonElement>("#field-notifications")?.addEventListener("click", () => {
    activeTab = "notifications"
    render()
  })
  document.querySelector<HTMLButtonElement>("#field-settings")?.addEventListener("click", () => {
    activeTab = "settings"
    render()
  })
  document.querySelector<HTMLButtonElement>("#enable-push")?.addEventListener("click", () => {
    void setupPushNotifications()
  })
  document.querySelector<HTMLFormElement>("#cherish-form")?.addEventListener("submit", (event) => void queueCherish(event))
  document.querySelector("#cherish-form select[name='cherishValue']")?.addEventListener("change", (event) => {
    if (!(event.currentTarget instanceof HTMLSelectElement)) return
    const parsed = cherishValueSchema.safeParse(event.currentTarget.value)
    if (parsed.success) cherishValue = parsed.data
  })
  document.querySelector("#cherish-form select[name='responseType']")?.addEventListener("change", (event) => {
    if (!(event.currentTarget instanceof HTMLSelectElement)) return
    const parsed = cherishResponseTypeSchema.safeParse(event.currentTarget.value)
    if (parsed.success) cherishResponseType = parsed.data
  })
  document.querySelector<HTMLTextAreaElement>("#cherish-form textarea[name='message']")?.addEventListener("input", (event) => {
    if (event.currentTarget instanceof HTMLTextAreaElement) cherishMessage = event.currentTarget.value
  })
  document.querySelector<HTMLButtonElement>("#native-sign-in")?.addEventListener("click", () => void beginNativeSignIn())
  document.querySelector<HTMLButtonElement>("#password-sign-in")?.addEventListener("click", beginPasswordSignIn)
  document.querySelector<HTMLButtonElement>("#email-code-sign-in")?.addEventListener("click", beginEmailCodeSignIn)
  document.querySelector<HTMLFormElement>("#native-password-form")?.addEventListener("submit", (event) => void signInWithPassword(event))
  document.querySelector<HTMLButtonElement>("#native-reset-password")?.addEventListener("click", () => void openPasswordReset())
  document.querySelector<HTMLFormElement>("#native-email-form")?.addEventListener("submit", (event) => void sendNativeEmailCode(event))
  document.querySelector<HTMLFormElement>("#native-code-form")?.addEventListener("submit", (event) => void verifyNativeEmailCode(event))
  document.querySelector<HTMLButtonElement>("[data-auth-choice]")?.addEventListener("click", showAuthChoices)
  document.querySelector<HTMLButtonElement>("[data-auth-email]")?.addEventListener("click", beginEmailCodeSignIn)
  document.querySelectorAll<HTMLButtonElement>("[data-notification-id]").forEach((button) => button.addEventListener("click", () => void openNotification(button)))
  document.querySelector<HTMLFormElement>("#daily-log-form")?.addEventListener("submit", (event) => void queueDailyLog(event))
  const messageInputs = document.querySelectorAll<HTMLTextAreaElement>("#chat-form textarea, #direct-message-form textarea, .direct-reply-form textarea")
  messageInputs.forEach((input) => input.addEventListener("focus", () => {
    document.body.classList.add("keyboard-open")
  }))
  document.querySelectorAll<HTMLButtonElement>("[data-keyboard-done]").forEach((button) => button.addEventListener("click", () => {
    messageInputs.forEach((input) => input.blur())
    void Keyboard.hide()
  }))
  document.querySelector<HTMLInputElement>("#daily-log-attachments")?.addEventListener("change", (event) => {
    const input = event.target
    if (!(input instanceof HTMLInputElement)) return
    void chooseDailyLogAttachments(input.files)
  })
  document.querySelectorAll<HTMLButtonElement>("[data-remove-attachment]").forEach((button) => button.addEventListener("click", () => void removeDraftAttachment(button.dataset.removeAttachment ?? "")))
  document.querySelector<HTMLFormElement>("#chat-form")?.addEventListener("submit", (event) => void queueChat(event))
  document.querySelector<HTMLTextAreaElement>("#chat-form textarea[name='content']")?.addEventListener("input", (event) => {
    if (event.currentTarget instanceof HTMLTextAreaElement) projectMessageDraft = event.currentTarget.value
  })
  const conversationSelect = document.querySelector("#message-conversation")
  if (conversationSelect instanceof HTMLSelectElement) {
    conversationSelect.addEventListener("change", (event) => {
      if (!(event.currentTarget instanceof HTMLSelectElement)) return
      openDirectChannelId = event.currentTarget.value === PROJECT_CONVERSATION_KEY
        ? null
        : event.currentTarget.value
      render()
    })
  }
  document.querySelectorAll<HTMLFormElement>(".direct-reply-form").forEach((form) => {
    form.addEventListener("submit", (event) => void queueDirectReply(event))
    const channelId = form.dataset.directChannelId ?? ""
    form.querySelector<HTMLTextAreaElement>("textarea[name='content']")?.addEventListener("input", (event) => {
      if (channelId && event.currentTarget instanceof HTMLTextAreaElement) {
        directReplyDrafts[channelId] = event.currentTarget.value
      }
    })
  })
  document.querySelector<HTMLButtonElement>("#start-project-channel")?.addEventListener("click", () => void startProjectChannel())
  document.querySelector<HTMLButtonElement>("#refresh-project-messages")?.addEventListener("click", () => void refreshProjectPacket())
  document.querySelector<HTMLFormElement>("#direct-message-form")?.addEventListener("submit", (event) => void sendDirectMessage(event))
  const directRecipientSelect = document.querySelector("#direct-message-form select[name='targetUserId']")
  if (directRecipientSelect instanceof HTMLSelectElement) {
    directRecipientSelect.addEventListener("change", (event) => {
      if (event.currentTarget instanceof HTMLSelectElement) {
        directRecipientId = event.currentTarget.value
      }
    })
  }
  document.querySelector<HTMLTextAreaElement>("#direct-message-form textarea[name='content']")?.addEventListener("input", (event) => {
    if (event.currentTarget instanceof HTMLTextAreaElement) directMessageDraft = event.currentTarget.value
  })
}

function bindProjectPickerResultEvents(): void {
  document.querySelector<HTMLButtonElement>("#clear-project-filters")?.addEventListener("click", () => {
    projectCompanyFilter = "all"
    projectSearch = ""
    const companySelect = document.querySelector("#project-company-filter")
    const searchInput = document.querySelector<HTMLInputElement>("#project-search")
    if (companySelect instanceof HTMLSelectElement) companySelect.value = "all"
    if (searchInput) {
      searchInput.value = ""
      searchInput.focus()
    }
    refreshProjectPickerResults()
  })
}

function refreshProjectPickerResults(): void {
  const results = document.querySelector<HTMLDivElement>("#project-picker-results")
  if (!results) return
  results.innerHTML = projectPickerResults()
  results.querySelectorAll<HTMLButtonElement>("[data-project-id]").forEach((button) => {
    button.addEventListener("click", () => void selectProject(button.dataset.projectId ?? ""))
  })
  bindProjectPickerResultEvents()
}

async function refreshProjectPacket(showProgress = true): Promise<void> {
  if (!packet || !online || refreshingProject) return
  const projectId = packet.project.id
  refreshingProject = true
  messageActionError = ""
  if (showProgress) render()
  try {
    const response = await CapacitorHttp.get({
      url: `${LIVE_URL}/api/field/projects/${encodeURIComponent(projectId)}`,
      responseType: "json",
    })
    const result = z.object({
      success: z.boolean(),
      error: z.string().optional(),
      packet: fieldProjectPacketSchema.optional(),
    }).safeParse(responseData(response.data))
    if (!result.success || !result.data.success || !result.data.packet) {
      throw new Error(
        result.success
          ? result.data.error ?? "Unable to refresh project messages."
          : "Unable to refresh project messages."
      )
    }
    packet = result.data.packet
    lastProjectRefreshAt = Date.now()
    await writeJson(packetKey(projectId), packet)
  } catch (error) {
    messageActionError =
      error instanceof Error ? error.message : "Unable to refresh project messages."
  } finally {
    refreshingProject = false
    render()
  }
}

async function openNotification(button: HTMLButtonElement): Promise<void> {
  const notificationId = button.dataset.notificationId
  if (!notificationId) return
  const href = button.dataset.notificationHref ?? ""
  const directChannelId = conversationChannelIdFromNotificationHref(href)
  if (directChannelId) {
    if (online) await markNotificationRead(notificationId)
    openDirectConversation(directChannelId)
    if (online) void refreshProjectPacket(false)
    return
  }

  const projectId = button.dataset.notificationProjectId
  if (online) {
    window.location.assign(`${LIVE_URL}/api/field/notifications/${encodeURIComponent(notificationId)}/open`)
    return
  }
  if (!projectId) return
  const result = fieldProjectPacketSchema.safeParse(await readJson(packetKey(projectId)))
  if (!result.success || !result.data.channel) return
  packet = result.data
  await writeJson(ACTIVE_PROJECT_KEY, projectId)
  activeTab = "chat"
  render()
}

async function markNotificationRead(notificationId: string): Promise<void> {
  try {
    const response = await CapacitorHttp.post({
      url: `${LIVE_URL}/api/field/notifications/${encodeURIComponent(notificationId)}/open`,
      headers: { "Content-Type": "application/json" },
      data: {},
      responseType: "json",
    })
    const result = z.object({ success: z.boolean() }).safeParse(responseData(response.data))
    if (!result.success || !result.data.success) return
    if (packet) {
      packet = {
        ...packet,
        notifications: packet.notifications.map((notification) =>
          notification.id === notificationId
            ? { ...notification, readAt: new Date().toISOString() }
            : notification
        ),
      }
      await writeJson(packetKey(packet.project.id), packet)
    }
  } catch {
    // Opening the direct conversation remains useful when read-state sync fails.
  }
}

function openDirectConversation(channelId: string): void {
  openDirectChannelId = channelId
  activeTab = "chat"
  render()
}

async function selectProject(projectId: string): Promise<void> {
  if (!projectId) return
  const result = fieldProjectPacketSchema.safeParse(await readJson(packetKey(projectId)))
  await writeJson(ACTIVE_PROJECT_KEY, projectId)
  if (!result.success) {
    if (online) {
      const downloaded = await downloadNativeFieldState(projectId).catch(() => false)
      if (!downloaded) {
        projectError = authError || "Compass could not download this project. Please try again."
        authError = ""
        activeTab = "projects"
        render()
      }
      return
    }
    projectError = "Open this project once while connected before using it offline."
    activeTab = "projects"
    render()
    return
  }
  projectError = ""
  documentFolderStack = []
  documentActionError = ""
  packet = result.data
  activeTab = "today"
  render()
  if (online) void refreshProjectPacket()
}

async function queueDailyLog(event: SubmitEvent): Promise<void> {
  event.preventDefault()
  if (!packet || !(event.currentTarget instanceof HTMLFormElement)) return
  const formElement = event.currentTarget
  const form = new FormData(formElement)
  const workCompleted = String(form.get("workCompleted") ?? "").trim()
  if (!workCompleted) return
  outbox.push({ id: crypto.randomUUID(), kind: "daily_log", projectId: packet.project.id, createdAt: new Date().toISOString(), payload: { logDate: String(form.get("logDate") ?? ""), workCompleted, issues: String(form.get("issues") ?? ""), crewPresent: String(form.get("crewPresent") ?? ""), notes: String(form.get("notes") ?? "") }, remoteDailyLogId: null, attachments: draftAttachments })
  await writeJson(OUTBOX_KEY, outbox)
  draftAttachments = []
  attachmentError = ""
  formElement.reset()
  render()
  if (online) void syncDailyLogOutbox()
}

async function uploadQueuedDailyLogAttachment(
  item: Extract<FieldOutboxItem, { readonly kind: "daily_log" }>,
  remoteDailyLogId: string,
  attachment: FieldQueuedAttachment
): Promise<void> {
  const storedFile = await Filesystem.readFile({
    path: attachment.localPath,
    directory: Directory.Data,
  })
  if (typeof storedFile.data !== "string") {
    throw new Error(`${attachment.fileName} could not be read for sync.`)
  }

  const binary = window.atob(storedFile.data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  const file = new File([bytes], attachment.fileName, {
    type: attachment.mimeType,
  })
  const formData = new FormData()
  formData.append("files", file)
  formData.set("dailyLogId", remoteDailyLogId)
  formData.set("capturedDate", item.payload.logDate)
  formData.set("photoKind", "progress")

  const response = await fetch(
    `${LIVE_URL}/api/projects/${encodeURIComponent(item.projectId)}/photos/upload`,
    { method: "POST", body: formData, credentials: "include" }
  )
  const responseBody: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof responseBody === "object" &&
      responseBody !== null &&
      "error" in responseBody &&
      typeof responseBody.error === "string"
        ? responseBody.error
        : `Unable to upload ${attachment.fileName}.`
    throw new Error(message)
  }

  await Filesystem.deleteFile({
    path: attachment.localPath,
    directory: Directory.Data,
  }).catch(() => undefined)
}

async function syncDailyLogOutbox(): Promise<void> {
  if (!online || syncingDailyLogs) return
  if (!outbox.some((item) => item.kind === "daily_log")) return

  syncingDailyLogs = true
  attachmentError = ""
  render()
  let syncedCount = 0
  try {
    syncedCount = await drainDailyLogOutbox(outbox, {
      createDailyLog: async (item) => {
        const response = await CapacitorHttp.post({
          url: `${LIVE_URL}/api/field/daily-logs`,
          headers: { "Content-Type": "application/json" },
          data: { id: item.id, projectId: item.projectId, payload: item.payload },
          responseType: "json",
        })
        const result = z.object({
          success: z.boolean(),
          dailyLogId: z.string().optional(),
          error: z.string().optional(),
        }).safeParse(responseData(response.data))
        if (!result.success || !result.data.success || !result.data.dailyLogId) {
          throw new Error(
            result.success
              ? result.data.error ?? "The daily log is saved and will retry."
              : "The daily log is saved and will retry."
          )
        }
        return result.data.dailyLogId
      },
      uploadAttachment: uploadQueuedDailyLogAttachment,
      persist: async (items) => {
        outbox = [...items]
        await writeJson(OUTBOX_KEY, outbox)
      },
    })
  } catch (error) {
    attachmentError = error instanceof Error
      ? error.message
      : "The daily log is saved and will retry."
  } finally {
    syncingDailyLogs = false
    render()
  }

  if (syncedCount > 0 && packet) void refreshProjectPacket()
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function attachmentFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return cleaned.length > 0 ? cleaned : "field-attachment"
}

async function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`))
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : ""
      const base64 = value.split(",")[1] ?? ""
      if (base64.length === 0) reject(new Error(`${file.name} was empty.`))
      else resolve(base64)
    }
    reader.readAsDataURL(file)
  })
}

async function chooseDailyLogAttachments(fileList: FileList | null): Promise<void> {
  if (!packet || fileList === null || fileList.length === 0) return
  attachmentError = ""
  try {
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} is larger than 50 MB.`)
      const id = crypto.randomUUID()
      const localPath = `${FIELD_ATTACHMENT_DIRECTORY}/${packet.project.id}/${id}-${attachmentFileName(file.name)}`
      await Filesystem.writeFile({ path: localPath, data: await fileBase64(file), directory: Directory.Data, recursive: true })
      draftAttachments.push({ id, localPath, fileName: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size, capturedAt: new Date().toISOString() })
    }
  } catch (error) {
    attachmentError = error instanceof Error ? error.message : "Unable to save the selected files."
  }
  render()
}

async function removeDraftAttachment(attachmentId: string): Promise<void> {
  const attachment = draftAttachments.find((item) => item.id === attachmentId)
  if (!attachment) return
  await Filesystem.deleteFile({ path: attachment.localPath, directory: Directory.Data }).catch(() => undefined)
  draftAttachments = draftAttachments.filter((item) => item.id !== attachmentId)
  render()
}

async function queueChat(event: SubmitEvent): Promise<void> {
  event.preventDefault()
  if (!packet?.channel || !(event.currentTarget instanceof HTMLFormElement)) return
  const formElement = event.currentTarget
  const form = new FormData(formElement)
  const content = String(form.get("content") ?? "").trim()
  if (!content) return
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  outbox.push({ id, kind: "chat_message", projectId: packet.project.id, createdAt, payload: { channelId: packet.channel.id, content } })
  packet = {
    ...packet,
    messages: [...packet.messages, { id, content, createdAt, userName: profile?.name ?? "You" }],
  }
  projectMessageDraft = ""
  await Promise.all([
    writeJson(OUTBOX_KEY, outbox),
    writeJson(packetKey(packet.project.id), packet),
  ])
  formElement.reset()
  render()
  if (online) void syncChatOutbox()
}

async function queueCherish(event: SubmitEvent): Promise<void> {
  event.preventDefault()
  if (!(event.currentTarget instanceof HTMLFormElement)) return

  const form = new FormData(event.currentTarget)
  const parsedValue = cherishValueSchema.safeParse(form.get("cherishValue"))
  const parsedResponseType = cherishResponseTypeSchema.safeParse(form.get("responseType"))
  const message = String(form.get("message") ?? "").trim()
  if (!parsedValue.success || !parsedResponseType.success || message.length < 3) {
    cherishFeedback = "Add a little more detail before saving."
    render()
    return
  }
  if (message.length > 1_200) {
    cherishFeedback = "Keep CHERISH responses under 1,200 characters."
    render()
    return
  }

  cherishValue = parsedValue.data
  cherishResponseType = parsedResponseType.data
  outbox.push({
    id: crypto.randomUUID(),
    kind: "cherish_pulse",
    cherishValue,
    responseType: cherishResponseType,
    message,
    createdAt: new Date().toISOString(),
  })
  await writeJson(OUTBOX_KEY, outbox)
  cherishMessage = ""
  cherishFeedback = online
    ? "Saved on this device. Syncing now."
    : "Saved on this device. It will sync when service returns."
  render()
  if (online) await syncCherishOutbox()
}

async function syncCherishOutbox(): Promise<void> {
  if (!online || syncingCherish) return
  const pending = outbox.filter((item) => item.kind === "cherish_pulse")
  if (pending.length === 0) return

  syncingCherish = true
  render()
  let syncedCount = 0
  try {
    for (const item of pending) {
      try {
        const response = await CapacitorHttp.post({
          url: `${LIVE_URL}/api/field/cherish`,
          headers: { "Content-Type": "application/json" },
          data: {
            id: item.id,
            cherishValue: item.cherishValue,
            responseType: item.responseType,
            message: item.message,
          },
          responseType: "json",
        })
        const result = z.object({
          success: z.boolean(),
          error: z.string().optional(),
        }).safeParse(responseData(response.data))
        if (!result.success || !result.data.success) {
          cherishFeedback = result.success
            ? result.data.error ?? "Saved on this device. Sign in to Full Compass when ready to sync."
            : "Saved on this device. Sign in to Full Compass when ready to sync."
          break
        }

        outbox = outbox.filter((queued) => queued.id !== item.id)
        syncedCount += 1
      } catch {
        cherishFeedback = "Saved on this device. Sign in to Full Compass when ready to sync."
        break
      }
    }
  } finally {
    if (syncedCount > 0) {
      await writeJson(OUTBOX_KEY, outbox)
      cherishFeedback = syncedCount === 1
        ? "Synced to the CHERISH review queue."
        : `Synced ${syncedCount} CHERISH responses.`
    }
    syncingCherish = false
    render()
  }
}

async function queueDirectReply(event: SubmitEvent): Promise<void> {
  event.preventDefault()
  if (!packet || !(event.currentTarget instanceof HTMLFormElement)) return
  const formElement = event.currentTarget
  const channelId = formElement.dataset.directChannelId ?? ""
  const content = String(new FormData(formElement).get("content") ?? "").trim()
  if (!channelId || !content) return
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  outbox.push({
    id,
    kind: "chat_message",
    projectId: packet.project.id,
    createdAt,
    payload: { channelId, content },
  })
  packet = appendOptimisticDirectMessage(packet, {
    channelId,
    id,
    content,
    createdAt,
    userName: profile?.name ?? "You",
  })
  openDirectChannelId = channelId
  directReplyDrafts[channelId] = ""
  await Promise.all([
    writeJson(OUTBOX_KEY, outbox),
    writeJson(packetKey(packet.project.id), packet),
  ])
  formElement.reset()
  render()
  if (online) void syncChatOutbox()
}

async function syncChatOutbox(): Promise<void> {
  if (!online || syncing) return
  const pending = outbox.filter((item) => item.kind === "chat_message")
  if (pending.length === 0) return

  syncing = true
  messageActionError = ""
  render()
  let syncedCount = 0
  try {
    for (const item of pending) {
      const response = await CapacitorHttp.post({
        url: `${LIVE_URL}/api/field/conversations/message`,
        headers: { "Content-Type": "application/json" },
        data: item.payload,
        responseType: "json",
      })
      const result = z.object({
        success: z.boolean(),
        error: z.string().optional(),
      }).safeParse(responseData(response.data))
      if (!result.success || !result.data.success) {
        throw new Error(
          result.success
            ? result.data.error ?? "The message is saved and will retry."
            : "The message is saved and will retry."
        )
      }

      outbox = outbox.filter((queued) => queued.id !== item.id)
      syncedCount += 1
    }
  } catch (error) {
    messageActionError = error instanceof Error
      ? error.message
      : "The message is saved and will retry."
  } finally {
    if (syncedCount > 0) await writeJson(OUTBOX_KEY, outbox)
    syncing = false
    render()
  }

  if (syncedCount > 0 && activeTab === "chat") {
    await refreshProjectPacket(false)
  }
}

function responseData(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

async function persistPushToken(token: string): Promise<void> {
  if (!online) {
    pushStatus = "error"
    if (activeTab === "settings") render()
    return
  }
  try {
    const platform = Capacitor.getPlatform()
    if (platform !== "ios" && platform !== "android") {
      throw new Error("Push notifications require a native platform.")
    }
    const response = await CapacitorHttp.post({
      url: `${LIVE_URL}/api/push/register`,
      headers: { "Content-Type": "application/json" },
      data: { token, platform },
      responseType: "json",
    })
    const result = z.object({ success: z.boolean() }).safeParse(responseData(response.data))
    pushStatus = result.success && result.data.success ? "enabled" : "error"
  } catch {
    pushStatus = "error"
  }
  if (activeTab === "settings") render()
}

async function requestPushPermissionAndRegister(): Promise<void> {
  pushStatus = "checking"
  if (activeTab === "settings") render()
  try {
    const checked = await PushNotifications.checkPermissions()
    const permission = checked.receive === "prompt"
      ? (await PushNotifications.requestPermissions()).receive
      : checked.receive
    if (permission !== "granted") {
      pushStatus = permission === "denied" ? "denied" : "permission_required"
      if (activeTab === "settings") render()
      return
    }
    await PushNotifications.register()
  } catch {
    pushStatus = "error"
    if (activeTab === "settings") render()
  }
}

async function setupPushNotifications(): Promise<void> {
  if (pushSetupStarted) {
    await requestPushPermissionAndRegister()
    return
  }
  try {
    await PushNotifications.addListener("registration", (token) => {
      pushToken = token.value
      void persistPushToken(token.value)
    })
    await PushNotifications.addListener("registrationError", () => {
      pushStatus = "error"
      if (activeTab === "settings") render()
    })
    await PushNotifications.addListener("pushNotificationReceived", () => {
      if (packet && online) void refreshProjectPacket(false)
    })
    await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const href = pushNotificationHref(action.notification.data)
      if (!href) return
      const channelId = conversationChannelIdFromNotificationHref(href)
      if (channelId) {
        openDirectConversation(channelId)
        if (packet && online) void refreshProjectPacket(false)
        return
      }
      if (href.startsWith("/dashboard/")) window.location.assign(liveAppUrl(href))
    })
    pushSetupStarted = true
    await requestPushPermissionAndRegister()
  } catch {
    pushSetupStarted = false
    pushStatus = "error"
    if (activeTab === "settings") render()
  }
}

async function startProjectChannel(): Promise<void> {
  if (!packet || !online || startingConversation) return
  startingConversation = true
  messageActionError = ""
  render()
  try {
    const response = await CapacitorHttp.post({
      url: `${LIVE_URL}/api/field/conversations/project`,
      headers: { "Content-Type": "application/json" },
      data: { projectId: packet.project.id },
      responseType: "json",
    })
    const result = z.object({
      success: z.boolean(),
      error: z.string().optional(),
      channel: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
      messages: fieldProjectPacketSchema.shape.messages.optional(),
    }).safeParse(responseData(response.data))
    if (!result.success || !result.data.success || !result.data.channel) {
      throw new Error(result.success ? result.data.error ?? "Unable to start the project channel." : "Unable to start the project channel.")
    }
    packet = {
      ...packet,
      channel: result.data.channel,
      messages: result.data.messages ?? [],
      syncedAt: new Date().toISOString(),
    }
    await writeJson(packetKey(packet.project.id), packet)
  } catch (error) {
    messageActionError = error instanceof Error ? error.message : "Unable to start the project channel."
  } finally {
    startingConversation = false
    render()
  }
}

async function sendDirectMessage(event: SubmitEvent): Promise<void> {
  event.preventDefault()
  if (!packet || !online || startingConversation || !(event.currentTarget instanceof HTMLFormElement)) return
  const formElement = event.currentTarget
  const form = new FormData(formElement)
  const targetUserId = String(form.get("targetUserId") ?? "")
  const content = String(form.get("content") ?? "").trim()
  if (!targetUserId || !content) return

  startingConversation = true
  directMessageStatus = ""
  messageActionError = ""
  render()
  try {
    const response = await CapacitorHttp.post({
      url: `${LIVE_URL}/api/field/conversations/direct`,
      headers: { "Content-Type": "application/json" },
      data: { targetUserId, content },
      responseType: "json",
    })
    const result = z.object({
      success: z.boolean(),
      error: z.string().optional(),
      channelId: z.string().optional(),
    }).safeParse(responseData(response.data))
    if (!result.success || !result.data.success) {
      throw new Error(result.success ? result.data.error ?? "Unable to send the direct message." : "Unable to send the direct message.")
    }
    const recipient = packet.contacts.find((contact) => contact.id === targetUserId)
    directMessageStatus = `Message sent${recipient ? ` to ${recipient.name}` : ""}.`
    directRecipientId = ""
    directMessageDraft = ""
    await refreshProjectPacket()
  } catch (error) {
    messageActionError = error instanceof Error ? error.message : "Unable to send the direct message."
  } finally {
    startingConversation = false
    render()
  }
}

async function openDocument(fileId: string): Promise<void> {
  if (!packet) return
  const saved = documents.find((document) => document.projectId === packet?.project.id && document.fileId === fileId)
  if (saved) {
    const result = await Filesystem.getUri({ path: saved.path, directory: Directory.Data })
    await FileViewer.openDocumentFromLocalPath({ path: result.uri })
    return
  }
  if (!online) return

  const currentFolder = documentFolderStack.at(-1) ?? null
  const document = (currentFolder?.documents ?? packet.documents).find((item) => item.id === fileId)
  if (!document) return
  if (document.type !== "folder") {
    await downloadDocumentForOffline(document)
    return
  }
  await browseDocumentFolder(document)
}

async function browseDocumentFolder(folder: FieldDocument): Promise<void> {
  if (!packet || !online || loadingDocumentFolderId) return
  const projectId = packet.project.id
  loadingDocumentFolderId = folder.id
  documentActionError = ""
  render()

  try {
    const response = await CapacitorHttp.get({
      url: `${LIVE_URL}/api/field/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folder.id)}`,
      responseType: "json",
    })
    const result = nativeFieldFolderResponseSchema.safeParse(
      responseData(response.data)
    )
    if (
      !result.success ||
      !result.data.success ||
      !result.data.folder ||
      !result.data.documents
    ) {
      throw new Error(
        result.success
          ? result.data.error ?? "Compass could not open this folder."
          : "Compass could not open this folder."
      )
    }

    documentFolderStack = [
      ...documentFolderStack,
      {
        id: result.data.folder.id,
        name: result.data.folder.name,
        documents: result.data.documents,
      },
    ]
  } catch (error) {
    documentActionError = error instanceof Error
      ? error.message
      : "Compass could not open this folder."
  } finally {
    loadingDocumentFolderId = ""
    render()
  }
}

function documentFileExtension(mimeType: string): string {
  if (mimeType === "application/pdf") return ".pdf"
  if (mimeType.includes("spreadsheet")) return ".xlsx"
  if (mimeType.includes("wordprocessingml")) return ".docx"
  if (mimeType.startsWith("image/jpeg")) return ".jpg"
  if (mimeType.startsWith("image/png")) return ".png"
  return ""
}

function safeDocumentFileName(name: string, mimeType: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project-document"
  const extension = documentFileExtension(mimeType)
  if (!extension || cleaned.toLocaleLowerCase().endsWith(extension)) return cleaned
  return `${cleaned}${extension}`
}

function responseHeader(
  headers: Readonly<Record<string, string>>,
  requestedName: string
): string | null {
  const normalizedName = requestedName.toLocaleLowerCase()
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLocaleLowerCase() === normalizedName) return value
  }
  return null
}

async function downloadDocumentForOffline(
  document: FieldDocument
): Promise<void> {
  if (!packet || downloadingDocumentId) return
  const projectId = packet.project.id
  downloadingDocumentId = document.id
  documentActionError = ""
  render()

  try {
    const response = await CapacitorHttp.get({
      url: `${LIVE_URL}/api/google/download/${encodeURIComponent(document.id)}?projectId=${encodeURIComponent(projectId)}`,
      responseType: "arraybuffer",
    })
    const data: unknown = response.data
    if (response.status < 200 || response.status >= 300 || typeof data !== "string" || data.length === 0) {
      throw new Error("Compass could not download this document.")
    }

    const mimeType = responseHeader(response.headers, "content-type")
      ?.split(";", 1)[0]
      ?.trim() || document.mimeType || "application/octet-stream"
    const path = `compass-field-documents/${projectId}/${safeDocumentFileName(document.name, mimeType)}`
    await Filesystem.writeFile({
      path,
      data,
      directory: Directory.Data,
      recursive: true,
    })

    const savedDocument: SavedDocument = {
      projectId,
      fileId: document.id,
      name: document.name,
      mimeType,
      path,
      savedAt: new Date().toISOString(),
    }
    documents = [
      ...documents.filter((saved) => saved.projectId !== projectId || saved.fileId !== document.id),
      savedDocument,
    ]
    await writeJson(DOCUMENTS_KEY, documents)
  } catch (error) {
    documentActionError = error instanceof Error
      ? error.message
      : "Compass could not download this document."
  } finally {
    downloadingDocumentId = ""
    render()
  }
}

function liveAppUrl(path: string): string {
  const url = new URL(path, LIVE_URL)
  const platform = Capacitor.getPlatform()
  if (platform === "ios" || platform === "android") {
    url.searchParams.set("nativePlatform", platform)
  }
  return url.toString()
}

function openFullCompass(): void {
  if (!online) return
  if (projects.length === 0) {
    if (profile) {
      window.location.assign(liveAppUrl("/dashboard/projects"))
      return
    }
    activeTab = "projects"
    render()
    return
  }
  const path = packet
    ? `/dashboard/projects/${encodeURIComponent(packet.project.id)}`
    : "/dashboard/projects"
  window.location.assign(liveAppUrl(path))
}

function openCherish(): void {
  activeTab = "cherish"
  render()
}

async function resumePendingSync(): Promise<void> {
  const focusedElement = document.activeElement
  const composing = focusedElement instanceof HTMLInputElement
    || focusedElement instanceof HTMLTextAreaElement
    || focusedElement?.getAttribute("contenteditable") === "true"
  if (syncing || syncingDailyLogs || composing || !online || outbox.length === 0) return
  await syncDailyLogOutbox()
  await syncCherishOutbox()
  await syncChatOutbox()
}

function base64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

async function createPkce(): Promise<{ readonly state: string; readonly verifier: string; readonly challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(64)))
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return {
    state: base64Url(crypto.getRandomValues(new Uint8Array(32))),
    verifier,
    challenge: base64Url(new Uint8Array(digest)),
  }
}

async function beginNativeSignIn(): Promise<void> {
  if (!online || signingIn) return
  signingIn = true
  authError = ""
  render()
  try {
    const pkce = await createPkce()
    await Preferences.set({ key: AUTH_STATE_KEY, value: pkce.state })
    await Preferences.set({ key: AUTH_VERIFIER_KEY, value: pkce.verifier })
    const params = new URLSearchParams({
      provider: "GoogleOAuth",
      mobile: "1",
      code_challenge: pkce.challenge,
      state: pkce.state,
    })
    await Browser.open({ url: `${LIVE_URL}/api/auth/sso?${params.toString()}` })
  } catch {
    signingIn = false
    authError = "Secure sign in could not be opened. Please try again."
    render()
  }
}

function beginEmailCodeSignIn(): void {
  if (!online || signingIn) return
  authMode = "email"
  authError = ""
  render()
}

function beginPasswordSignIn(): void {
  if (!online || signingIn) return
  authMode = "password"
  authError = ""
  render()
}

function showAuthChoices(): void {
  if (signingIn) return
  authMode = "choice"
  authError = ""
  render()
}

function nativeAuthData(value: unknown): z.infer<typeof nativeAuthResponseSchema> | null {
  if (typeof value === "string") {
    try {
      return nativeAuthResponseSchema.safeParse(JSON.parse(value)).data ?? null
    } catch {
      return null
    }
  }
  return nativeAuthResponseSchema.safeParse(value).data ?? null
}

async function downloadNativeFieldState(projectId?: string): Promise<boolean> {
  const params = new URLSearchParams()
  if (projectId) params.set("projectId", projectId)
  const query = params.toString()
  const response = await CapacitorHttp.get({
    url: `${LIVE_URL}/api/field/native-bootstrap${query ? `?${query}` : ""}`,
    responseType: "json",
  })
  const result = nativeFieldBootstrapResponseSchema.safeParse(
    responseData(response.data)
  )
  if (
    !result.success ||
    !result.data.success ||
    !result.data.profile ||
    !result.data.projects
  ) {
    authError = result.success
      ? result.data.error ?? "Compass could not download Field Mode. Please try again."
      : "Compass could not download Field Mode. Please try again."
    return false
  }

  projects = result.data.projects
  profile = result.data.profile
  packet = result.data.initialPacket ?? null
  const activeProjectId = packet?.project.id ?? projects[0]?.id ?? null
  await Promise.all([
    writeJson(PROFILE_KEY, profile),
    writeJson(PROJECTS_KEY, projects),
    writeJson(ACTIVE_PROJECT_KEY, activeProjectId),
    packet ? writeJson(packetKey(packet.project.id), packet) : Promise.resolve(),
  ])
  authMode = "choice"
  authError = ""
  projectError = ""
  signingIn = false
  activeTab = packet ? "today" : "projects"
  render()
  if (pushToken) void persistPushToken(pushToken)
  return true
}

async function openPasswordReset(): Promise<void> {
  if (!online || signingIn) return
  await Browser.open({ url: `${LIVE_URL}/reset-password` })
}

async function signInWithPassword(event: SubmitEvent): Promise<void> {
  event.preventDefault()
  if (!online || signingIn || !(event.currentTarget instanceof HTMLFormElement)) return
  const form = new FormData(event.currentTarget)
  const email = String(form.get("email") ?? "").trim().toLowerCase()
  const password = String(form.get("password") ?? "")
  if (!email || !email.includes("@") || !password) {
    authError = "Enter your email address and password."
    render()
    return
  }

  signingIn = true
  authError = ""
  authEmail = email
  render()
  try {
    const response = await CapacitorHttp.post({
      url: `${LIVE_URL}/api/auth/login`,
      headers: { "Content-Type": "application/json" },
      data: { type: "password", email, password },
      responseType: "json",
    })
    const result = nativeAuthData(response.data)
    if (!result?.success) {
      authError = result?.error ?? "Compass could not sign you in. Please try again."
      signingIn = false
      render()
      return
    }
    if (!await downloadNativeFieldState()) {
      signingIn = false
      render()
    }
  } catch {
    authError = "Compass could not sign you in. Check your connection and try again."
    signingIn = false
    render()
  }
}

async function sendNativeEmailCode(event: SubmitEvent): Promise<void> {
  event.preventDefault()
  if (!online || signingIn || !(event.currentTarget instanceof HTMLFormElement)) return
  const email = String(new FormData(event.currentTarget).get("email") ?? "").trim().toLowerCase()
  if (!email || !email.includes("@")) {
    authError = "Enter a valid email address."
    render()
    return
  }

  signingIn = true
  authError = ""
  authEmail = email
  render()
  try {
    const response = await CapacitorHttp.post({
      url: `${LIVE_URL}/api/auth/login`,
      headers: { "Content-Type": "application/json" },
      data: { type: "passwordless_send", email },
      responseType: "json",
    })
    const result = nativeAuthData(response.data)
    if (!result?.success) {
      authError = result?.error ?? "Compass could not send the code. Please try again."
      return
    }
    authMode = "code"
  } catch {
    authError = "Compass could not send the code. Check your connection and try again."
  } finally {
    signingIn = false
    render()
  }
}

async function verifyNativeEmailCode(event: SubmitEvent): Promise<void> {
  event.preventDefault()
  if (!online || signingIn || !(event.currentTarget instanceof HTMLFormElement)) return
  const code = String(new FormData(event.currentTarget).get("code") ?? "").trim()
  if (!/^\d{6}$/.test(code)) {
    authError = "Enter the six-digit code from your email."
    render()
    return
  }

  signingIn = true
  authError = ""
  render()
  try {
    const response = await CapacitorHttp.post({
      url: `${LIVE_URL}/api/auth/login`,
      headers: { "Content-Type": "application/json" },
      data: { type: "passwordless_verify", email: authEmail, code },
      responseType: "json",
    })
    const result = nativeAuthData(response.data)
    if (!result?.success) {
      authError = result?.error ?? "The code could not be verified. Please try again."
      signingIn = false
      render()
      return
    }
    if (!await downloadNativeFieldState()) {
      signingIn = false
      render()
    }
  } catch {
    authError = "The code could not be verified. Check your connection and try again."
    signingIn = false
    render()
  }
}

function resetAbandonedSignIn(): void {
  if (!signingIn) return
  signingIn = false
  render()
}

async function handleAuthCallback(url: URL): Promise<void> {
  if (url.protocol !== "compass:" || url.hostname !== "auth" || url.pathname !== "/callback") return

  await Browser.close().catch(() => undefined)
  signingIn = false
  const error = url.searchParams.get("error")
  if (error) {
    authError = "Sign in was not completed. Please try again."
    render()
    return
  }

  const code = url.searchParams.get("code")
  const returnedState = url.searchParams.get("state")
  const [stateResult, verifierResult] = await Promise.all([
    Preferences.get({ key: AUTH_STATE_KEY }),
    Preferences.get({ key: AUTH_VERIFIER_KEY }),
  ])
  if (!code || !returnedState || returnedState !== stateResult.value || !verifierResult.value) {
    authError = "Secure sign in could not be verified. Please try again."
    render()
    return
  }

  signingIn = true
  render()
  try {
    const platform = Capacitor.getPlatform()
    const response = await CapacitorHttp.post({
      url: `${LIVE_URL}/api/auth/mobile/session`,
      headers: { "Content-Type": "application/json" },
      data: {
        code,
        codeVerifier: verifierResult.value,
        ...(platform === "ios" || platform === "android"
          ? { nativePlatform: platform }
          : {}),
      },
      responseType: "json",
    })
    const result = nativeAuthData(response.data)
    if (!result?.success) {
      authError = result?.error ?? "Secure sign in could not be completed. Please try again."
      signingIn = false
      render()
      return
    }
    await Promise.all([
      Preferences.remove({ key: AUTH_STATE_KEY }),
      Preferences.remove({ key: AUTH_VERIFIER_KEY }),
    ])
    if (!await downloadNativeFieldState()) {
      signingIn = false
      render()
    }
  } catch {
    authError = "Secure sign in could not be completed. Please try again."
    signingIn = false
    render()
  }
}

async function handleAppUrl(appUrl: string): Promise<void> {
  if (isFieldAppUrl(appUrl)) {
    await Browser.close().catch(() => undefined)
    activeTab = packet ? "today" : "projects"
    authError = ""
    render()
    return
  }

  const dashboardUrl = resolveDashboardAppUrl(appUrl, LIVE_URL)
  if (dashboardUrl) {
    const exceededBackgroundThreshold =
      backgroundedAt !== null &&
      Date.now() - backgroundedAt > BACKGROUND_LOCK_THRESHOLD_MS
    if (
      biometricEnabled &&
      (biometricLocked || exceededBackgroundThreshold)
    ) {
      pendingAppUrl = appUrl
      biometricLocked = true
      render()
      await unlockCompass()
      return
    }
    window.location.assign(dashboardUrl)
    return
  }

  let url: URL
  try {
    url = new URL(appUrl)
  } catch {
    return
  }

  await handleAuthCallback(url)
}

async function initialize(): Promise<void> {
  if (isIos) {
    document.body.classList.add("platform-ios")
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native })
    await Keyboard.setScroll({ isDisabled: false })
  }
  const initialStatus = await Network.getStatus()
  online = initialStatus.connected
  const storedBiometricPreference = await biometricPreference()
  // Older releases stored this choice on the live origin. Keep Field Mode
  // available during migration; opening Full Compass copies the legacy choice
  // into shared native Preferences for subsequent offline launches.
  biometricEnabled = storedBiometricPreference ?? false
  biometricLocked = biometricEnabled
  if (biometricLocked) render()
  await Keyboard.addListener("keyboardWillShow", ({ keyboardHeight }) => {
    document.documentElement.style.setProperty("--keyboard-height", `${keyboardHeight}px`)
    document.body.classList.add("keyboard-open")
    window.setTimeout(() => {
      const focusedElement = document.activeElement
      if (focusedElement instanceof HTMLElement) {
        focusedElement.scrollIntoView({ block: "nearest", inline: "nearest" })
      }
    }, 120)
  })
  await Keyboard.addListener("keyboardWillHide", () => {
    document.body.classList.remove("keyboard-open")
    document.documentElement.style.setProperty("--keyboard-height", "0px")
  })
  await App.addListener("appUrlOpen", ({ url }) => void handleAppUrl(url))
  await Browser.addListener("browserFinished", resetAbandonedSignIn)
  void setupPushNotifications()
  await App.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) {
      backgroundedAt = Date.now()
      return
    }
    const elapsed = backgroundedAt === null ? 0 : Date.now() - backgroundedAt
    backgroundedAt = null
    if (elapsed > BACKGROUND_LOCK_THRESHOLD_MS) {
      void lockCompassIfEnabled()
      return
    }
    window.setTimeout(resetAbandonedSignIn, 1_000)
    void refreshConnectivityAndSync()
  })
  const launchUrl = await App.getLaunchUrl()
  const launchUrlQueued = Boolean(launchUrl?.url && biometricLocked)
  if (launchUrlQueued && launchUrl?.url) pendingAppUrl = launchUrl.url

  const projectResult = projectsSchema.safeParse(await readJson(PROJECTS_KEY))
  const outboxResult = fieldOutboxSchema.safeParse(await readJson(OUTBOX_KEY))
  const documentResult = savedDocumentsSchema.safeParse(await readJson(DOCUMENTS_KEY))
  const profileResult = fieldUserProfileSchema.safeParse(await readJson(PROFILE_KEY))
  const activeProjectResult = z.string().nullable().safeParse(await readJson(ACTIVE_PROJECT_KEY))
  projects = projectResult.success ? projectResult.data : []
  outbox = outboxResult.success ? outboxResult.data : []
  documents = documentResult.success ? documentResult.data : []
  profile = profileResult.success ? profileResult.data : null
  if (projects.length === 0) activeTab = "projects"
  const activeProjectId = activeProjectResult.success ? activeProjectResult.data : null
  const selectedId = projects.some((project) => project.id === activeProjectId)
    ? activeProjectId
    : projects[0]?.id ?? null
  const packetResult = selectedId
    ? fieldProjectPacketSchema.safeParse(await readJson(packetKey(selectedId)))
    : null
  packet = packetResult?.success ? packetResult.data : null
  render()
  if (biometricLocked) await unlockCompass()
  if (launchUrl?.url && !launchUrlQueued && !biometricLocked) {
    await handleAppUrl(launchUrl.url)
  }
  if (online && packet) void refreshProjectPacket()
  void resumePendingSync()

  await Network.addListener("networkStatusChange", () => void refreshConnectivityAndSync())
  window.addEventListener("online", () => void refreshConnectivityAndSync())
  window.addEventListener("pageshow", () => void refreshConnectivityAndSync())
  window.setInterval(() => void refreshConnectivityAndSync(), 5_000)
}

async function refreshConnectivityAndSync(): Promise<void> {
  const previousOnline = online
  const previousOutbox = JSON.stringify(outbox)
  const [status, storedOutbox] = await Promise.all([
    Network.getStatus(),
    readJson(OUTBOX_KEY),
  ])
  const outboxResult = fieldOutboxSchema.safeParse(storedOutbox)
  online = status.connected
  if (outboxResult.success) outbox = outboxResult.data
  if (previousOnline !== online || previousOutbox !== JSON.stringify(outbox)) render()
  void resumePendingSync()
  if (!previousOnline && online && pushToken && pushStatus !== "enabled") {
    void persistPushToken(pushToken)
  }
  if (!previousOnline && online && activeTab === "chat") {
    void refreshProjectPacket()
    return
  }
  const focusedElement = document.activeElement
  const composingMessage = focusedElement instanceof HTMLTextAreaElement
    || projectMessageDraft.trim().length > 0
    || directMessageDraft.trim().length > 0
    || Object.values(directReplyDrafts).some((draft) => draft.trim().length > 0)
  if (
    online &&
    packet &&
    activeTab === "chat" &&
    !composingMessage &&
    Date.now() - lastProjectRefreshAt >= 15_000
  ) {
    void refreshProjectPacket(false)
  }
}

void initialize()
