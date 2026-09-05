import * as React from "react"

import { getCorrespondenceDetail, saveCorrespondenceDraft } from "@/app/actions/project-correspondence"
import type {
  CorrespondenceAttachment,
  CorrespondenceDetail,
  CorrespondenceMessage,
  CorrespondenceSummary,
} from "@/lib/correspondence/types"

export type StagedAttachment = {
  readonly localId: string
  readonly file: File
  readonly state: "uploading" | "ready" | "failed"
  readonly attachment: CorrespondenceAttachment | null
}

export type ComposerTransitionBlock = "busy" | "editing" | "attachments" | null

export function detailForConversation(detail: CorrespondenceDetail | null, conversationId: string | null): CorrespondenceDetail | null {
  return detail !== null && conversationId !== null && detail.conversation.id === conversationId ? detail : null
}

export function composerTransitionBlock(input: {
  readonly busy: boolean
  readonly editing: boolean
  readonly attachmentCount: number
}): ComposerTransitionBlock {
  if (input.busy) return "busy"
  if (input.editing) return "editing"
  if (input.attachmentCount > 0) return "attachments"
  return null
}

export function filterConversations(conversations: readonly CorrespondenceSummary[], filter: "inbox" | "unread" | "follow-up" | "saved" | "archived", query: string): readonly CorrespondenceSummary[] {
  const normalized = query.trim().toLocaleLowerCase()
  return conversations.filter((conversation) => {
    const filterMatch = filter === "archived" ? conversation.archived : !conversation.archived && (filter === "inbox" || filter === "unread" && conversation.unread || filter === "follow-up" && conversation.followUp || filter === "saved" && conversation.saved)
    const searchMatch = !normalized || [conversation.subject, conversation.excerpt, ...conversation.people.map((person) => person.name)].join(" ").toLocaleLowerCase().includes(normalized)
    return filterMatch && searchMatch
  })
}

export function earliestSequence(messages: readonly CorrespondenceMessage[]): number | undefined { return messages[0]?.sequence }

export async function loadMessageHistory(projectId: string, conversationId: string, messageId: string, firstPage: CorrespondenceDetail): Promise<CorrespondenceDetail> {
  let detail = firstPage
  let before = earliestSequence(detail.messages)
  while (before !== undefined && !detail.messages.some((message) => message.id === messageId) && detail.hasEarlier) {
    const result = await getCorrespondenceDetail(projectId, conversationId, before)
    if (!result.success || result.data.messages.length === 0) break
    const messages = mergeMessages(result.data.messages, detail.messages)
    detail = { ...result.data, messages }
    const nextBefore = earliestSequence(result.data.messages)
    if (nextBefore === before) break
    before = nextBefore
  }
  return detail
}

export function mergeMessages(older: readonly CorrespondenceMessage[], newer: readonly CorrespondenceMessage[]): readonly CorrespondenceMessage[] {
  const byId = new Map<string, CorrespondenceMessage>()
  for (const message of [...older, ...newer]) byId.set(message.id, message)
  return [...byId.values()].sort((left, right) => left.sentAt.localeCompare(right.sentAt) || left.sequence - right.sequence)
}

export function applyMessageRevision(messages: readonly CorrespondenceMessage[], messageId: string, body: string | null, revisedAt: string): readonly CorrespondenceMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId) return message
    const readReceipts = message.readReceipts.map((receipt) => receipt.status === "unavailable" ? receipt : { ...receipt, status: "not_opened" as const, openedAt: null })
    return body === null ? { ...message, retractedAt: revisedAt, readReceipts } : { ...message, body, editedAt: revisedAt, readReceipts }
  })
}

export async function saveDraft(projectId: string, detail: CorrespondenceDetail, body: string, setDetail: React.Dispatch<React.SetStateAction<CorrespondenceDetail | null>>, setStatus: (status: string | null) => void): Promise<void> {
  const expectedVersion = detail.draft?.version ?? 0
  const result = await saveCorrespondenceDraft(projectId, detail.conversation.id, body, expectedVersion)
  if (!result.success) {
    setStatus(result.error)
    return
  }
  setDetail((current) => current?.conversation.id === detail.conversation.id ? { ...current, draft: { body, version: result.data.version } } : current)
}

export async function uploadStagedAttachment(projectId: string, candidate: StagedAttachment, setStagedAttachments: React.Dispatch<React.SetStateAction<readonly StagedAttachment[]>>): Promise<void> {
  try {
    const form = new FormData()
    form.append("projectId", projectId)
    form.append("file", candidate.file)
    const response = await fetch("/api/correspondence/attachments", { method: "POST", body: form })
    const payload: unknown = await response.json()
    const attachment = attachmentFromResponse(payload)
    if (!response.ok || attachment === null) throw new Error("Upload failed")
    setStagedAttachments((items) => items.map((item) => item.localId === candidate.localId ? { ...item, state: "ready", attachment } : item))
  } catch {
    setStagedAttachments((items) => items.map((item) => item.localId === candidate.localId ? { ...item, state: "failed" } : item))
  }
}

function attachmentFromResponse(payload: unknown): CorrespondenceAttachment | null {
  if (typeof payload !== "object" || payload === null || !("success" in payload) || payload.success !== true || !("data" in payload)) return null
  const data = payload.data
  if (typeof data !== "object" || data === null || !("id" in data) || !("name" in data) || !("size" in data) || !("contentType" in data)) return null
  if (typeof data.id !== "string" || typeof data.name !== "string" || typeof data.size !== "number" || typeof data.contentType !== "string") return null
  return { id: data.id, name: data.name, size: data.size, contentType: data.contentType, available: true }
}
