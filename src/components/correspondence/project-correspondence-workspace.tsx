"use client"
import * as React from "react"
import { ArrowLeft, ChevronDown, LoaderCircle, Search } from "lucide-react"
import {
  discardCorrespondenceDraft,
  getCorrespondenceDetail,
  getCorrespondenceInbox,
  markCorrespondenceOpened,
  reviseCorrespondenceMessage,
  searchCorrespondence,
  saveCorrespondenceDraft,
  saveCorrespondenceCompositionDraft,
  sendCorrespondence,
  setCorrespondenceClosed,
  setCorrespondenceReceiptPreference,
  setCorrespondenceState,
} from "@/app/actions/project-correspondence"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import {
  ConversationMenu,
  ConversationTags,
  EmptyDetail,
  SearchResults,
} from "./correspondence-workspace-parts"
import { MessageCard } from "./correspondence-message-card"
import { Composer, NewMessagePanel } from "./correspondence-composer"
import {
  earliestSequence,
  filterConversations,
  applyMessageRevision,
  composerTransitionBlock,
  detailForConversation,
  loadMessageHistory,
  mergeMessages,
  uploadStagedAttachment,
  type StagedAttachment,
} from "./correspondence-workspace-utils"
import type { CorrespondenceDetail, CorrespondenceInbox, CorrespondenceMessage, CorrespondencePerson, CorrespondenceStateInput, CorrespondenceSummary, SendCorrespondenceInput } from "@/lib/correspondence/types"
import { useQuickAddEntry } from "@/hooks/use-quick-add-entry"
type ProjectCorrespondenceWorkspaceProps = { readonly projectId: string; readonly initialInbox: CorrespondenceInbox; readonly initialConversationId?: string; readonly initialMessageId?: string; readonly initialNewMessage?: boolean }
type InboxFilter = "inbox" | "unread" | "follow-up" | "saved" | "archived"
type ComposeMode = { readonly kind: "reply" } | { readonly kind: "new"; readonly subject: string; readonly recipientIds: readonly string[] }
type NewDraft = { readonly subject: string; readonly recipientIds: readonly string[]; readonly body: string; readonly version: number }
type PendingSend = { readonly input: SendCorrespondenceInput }
type SearchHit = { readonly conversationId: string; readonly messageId: string; readonly subject: string; readonly excerpt: string; readonly sentAt: string }
const POLL_INTERVAL_MS = 20_000
export function ProjectCorrespondenceWorkspace({ projectId, initialInbox, initialConversationId, initialMessageId, initialNewMessage = false }: ProjectCorrespondenceWorkspaceProps): React.ReactElement {
  const initialCompositionDraft = compositionDraft(initialInbox)
  const [inbox, setInbox] = React.useState(initialInbox)
  const [activeId, setActiveId] = React.useState<string | null>(
    initialConversationId ?? initialInbox.conversations[0]?.id ?? null,
  )
  const [detail, setDetail] = React.useState<CorrespondenceDetail | null>(null)
  const [filter, setFilter] = React.useState<InboxFilter>("inbox")
  const [query, setQuery] = React.useState("")
  const [searchHits, setSearchHits] = React.useState<readonly SearchHit[]>([])
  const [searchHasMore, setSearchHasMore] = React.useState(false)
  const [mobileDetail, setMobileDetail] = React.useState(initialConversationId !== undefined || initialNewMessage)
  const [newDraft, setNewDraft] = React.useState<NewDraft>(initialCompositionDraft)
  const [compose, setCompose] = React.useState<ComposeMode | null>(() => initialNewMessage ? {
    kind: "new",
    subject: initialCompositionDraft.subject,
    recipientIds: initialCompositionDraft.recipientIds,
  } : null)
  const [replyBody, setReplyBody] = React.useState(() => initialNewMessage ? initialCompositionDraft.body : "")
  const [stagedAttachments, setStagedAttachments] = React.useState<readonly StagedAttachment[]>([])
  const [status, setStatus] = React.useState<string | null>(null)
  const [isLoadingDetail, setIsLoadingDetail] = React.useState(false)
  const [isSending, setIsSending] = React.useState(false)
  const [isNavigating, setIsNavigating] = React.useState(false)
  const [hasPendingSend, setHasPendingSend] = React.useState(false)
  const [editingMessage, setEditingMessage] = React.useState<CorrespondenceMessage | null>(null)
  const [pendingRetraction, setPendingRetraction] = React.useState<CorrespondenceMessage | null>(null)
  const [discardDraftOpen, setDiscardDraftOpen] = React.useState(false)
  const [focusMessageId, setFocusMessageId] = React.useState(initialMessageId)
  const detailRequest = React.useRef(0)
  const inboxRequest = React.useRef(0)
  const detailRef = React.useRef<CorrespondenceDetail | null>(null)
  const composeRef = React.useRef<ComposeMode | null>(null)
  const editingMessageRef = React.useRef<CorrespondenceMessage | null>(null)
  const replyDirty = React.useRef(false)
  const replyBodyRef = React.useRef(replyBody)
  const replyDraftVersion = React.useRef(0)
  const replySave = React.useRef<Promise<boolean>>(Promise.resolve(true))
  const openedMessageIds = React.useRef(new Set<string>())
  const pendingSend = React.useRef<PendingSend | null>(null)
  const sendInProgress = React.useRef(false)
  const navigationInProgress = React.useRef(false)
  const compositionSave = React.useRef<Promise<boolean>>(Promise.resolve(true))
  const compositionVersion = React.useRef(newDraft.version)
  const newDraftRef = React.useRef(newDraft)
  const newDraftDirty = React.useRef(false)
  const activeSummary = React.useMemo(
    () => inbox.conversations.find((conversation) => conversation.id === activeId) ?? null,
    [activeId, inbox.conversations],
  )
  const visibleConversations = React.useMemo(
    () => filterConversations(inbox.conversations, filter, query),
    [filter, inbox.conversations, query],
  )
  const activeDetail = detailForConversation(detail, activeId)
  React.useEffect(() => {
    detailRef.current = detail
  }, [detail])
  React.useEffect(() => { composeRef.current = compose }, [compose])
  React.useEffect(() => { editingMessageRef.current = editingMessage }, [editingMessage])
  React.useEffect(() => { replyBodyRef.current = replyBody }, [replyBody])
  React.useEffect(() => { newDraftRef.current = newDraft }, [newDraft])
  React.useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setSearchHits([])
      setSearchHasMore(false)
      return
    }
    let current = true
    const timer = window.setTimeout(() => {
      void searchCorrespondence(projectId, trimmed).then((result) => {
        if (!current) return
        if (!result.success) { setSearchHits([]); setSearchHasMore(false); setStatus(result.error); return }
        setSearchHits(result.data.hits)
        setSearchHasMore(result.data.hasMore)
      })
    }, 250)
    return () => { current = false; window.clearTimeout(timer) }
  }, [projectId, query])
  const refreshInbox = React.useCallback(async (): Promise<CorrespondenceInbox | null> => {
    const request = ++inboxRequest.current
    const result = await getCorrespondenceInbox(projectId)
    if (request !== inboxRequest.current || !result.success) return null
    setInbox(result.data)
    return result.data
  }, [projectId])
  const saveCompositionDraft = React.useCallback(async (draft: NewDraft): Promise<boolean> => {
    const queued = compositionSave.current.catch(() => false).then(async (): Promise<boolean> => {
      let result: Awaited<ReturnType<typeof saveCorrespondenceCompositionDraft>>
      try {
        result = await saveCorrespondenceCompositionDraft(projectId, {
          subject: draft.subject,
          body: draft.body,
          recipientUserIds: draft.recipientIds,
          version: compositionVersion.current,
        })
      } catch {
        setStatus("The new-message draft could not be saved. Your text is still here.")
        return false
      }
      if (!result.success) { setStatus(result.error); return false }
      compositionVersion.current = result.data.version
      if (compositionKey(newDraftRef.current) === compositionKey(draft)) {
        newDraftDirty.current = false
        newDraftRef.current = { ...newDraftRef.current, version: result.data.version }
      }
      setNewDraft((current) => ({ ...current, version: result.data.version }))
      return true
    })
    compositionSave.current = queued
    return queued
  }, [projectId])
  const saveReplyDraft = React.useCallback(async (conversationId: string, body: string): Promise<boolean> => {
    const queued = replySave.current.catch(() => false).then(async (): Promise<boolean> => {
      let result: Awaited<ReturnType<typeof saveCorrespondenceDraft>>
      try {
        result = await saveCorrespondenceDraft(projectId, conversationId, body, replyDraftVersion.current)
      } catch {
        setStatus("This draft could not be saved. Your text is still here.")
        return false
      }
      if (!result.success) { setStatus(result.error); return false }
      replyDraftVersion.current = result.data.version
      const currentDetail = detailRef.current
      if (currentDetail?.conversation.id === conversationId) {
        detailRef.current = { ...currentDetail, draft: { body, version: result.data.version } }
      }
      setDetail((current) => current?.conversation.id === conversationId ? { ...current, draft: { body, version: result.data.version } } : current)
      if (replyBodyRef.current === body) replyDirty.current = false
      return true
    })
    replySave.current = queued
    return queued
  }, [projectId])
  const markOpened = React.useCallback(async (conversationId: string, messages: readonly { readonly id: string; readonly editedAt: string | null }[]): Promise<void> => {
    if (conversationId !== activeId || document.visibilityState !== "visible" || !document.hasFocus()) return
    const unopened = messages.filter((message) => !openedMessageIds.current.has(`${message.id}:${message.editedAt ?? ""}`))
    for (let index = 0; index < unopened.length; index += 50) {
      const batch = unopened.slice(index, index + 50)
      const result = await markCorrespondenceOpened(projectId, conversationId, batch)
      if (!result.success) return
      for (const message of batch) openedMessageIds.current.add(`${message.id}:${message.editedAt ?? ""}`)
    }
    if (unopened.length > 0) void refreshInbox()
  }, [activeId, projectId, refreshInbox])
  const loadDetail = React.useCallback(
    async (
      conversationId: string,
      messageId?: string,
      beforeSequence?: number,
    ): Promise<void> => {
      const request = ++detailRequest.current
      setIsLoadingDetail(true)
      const result = await getCorrespondenceDetail(projectId, conversationId, beforeSequence)
      if (request !== detailRequest.current) return
      setIsLoadingDetail(false)
      if (!result.success) {
        detailRef.current = null
        setDetail(null)
        setStatus("This conversation is unavailable.")
        return
      }
      let nextDetail = result.data
      const currentDetail = detailRef.current
      if (currentDetail?.conversation.id === conversationId) {
        nextDetail = {
          ...nextDetail,
          messages: mergeMessages(currentDetail.messages, nextDetail.messages),
        }
      }
      if (messageId && !nextDetail.messages.some((message) => message.id === messageId)) {
        nextDetail = await loadMessageHistory(projectId, conversationId, messageId, nextDetail)
      }
      if (request !== detailRequest.current) return
      detailRef.current = nextDetail
      setDetail(nextDetail)
      if (composeRef.current === null) {
        replyDraftVersion.current = nextDetail.draft?.version ?? 0
        replaceReplyBody(nextDetail.draft?.body ?? "")
      }
    },
    [projectId],
  )
  React.useEffect(() => {
    if (activeId === null) {
      detailRequest.current += 1
      detailRef.current = null
      setDetail(null)
      return
    }
    void loadDetail(activeId, focusMessageId)
  }, [activeId, focusMessageId, loadDetail])
  React.useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshInbox()
      if (activeId !== null) void loadDetail(activeId)
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [activeId, loadDetail, refreshInbox])
  React.useEffect(() => {
    if (compose?.kind !== "reply" || activeDetail === null || editingMessage !== null) return
    if (activeDetail.draft?.body === replyBody || activeDetail.draft === null && replyBody === "") return
    const timer = window.setTimeout(() => {
      if (!sendInProgress.current && pendingSend.current === null && !navigationInProgress.current) {
        void saveReplyDraft(activeDetail.conversation.id, replyBody)
      }
    }, 700)
    return () => window.clearTimeout(timer)
  }, [activeDetail, compose?.kind, editingMessage, replyBody, saveReplyDraft])
  React.useEffect(() => {
    if (compose?.kind !== "new" || !newDraftDirty.current || sendInProgress.current || pendingSend.current !== null || navigationInProgress.current) return
    const timer = window.setTimeout(() => {
      if (!sendInProgress.current && pendingSend.current === null && !navigationInProgress.current) {
        void saveCompositionDraft(newDraftRef.current)
      }
    }, 700)
    return () => window.clearTimeout(timer)
  }, [compose?.kind, newDraft, saveCompositionDraft])
  async function openConversation(conversationId: string, messageId?: string): Promise<void> {
    if (blockComposerTransition("changing conversations")) return
    if (!await flushComposerBeforeNavigation()) return
    replyDirty.current = false
    editingMessageRef.current = null
    setEditingMessage(null)
    setFocusMessageId(messageId)
    if (conversationId !== activeId) invalidateDetail()
    setActiveId(conversationId)
    composeRef.current = null
    setCompose(null)
    setMobileDetail(true)
    setStatus(null)
  }
  async function startNewMessage(): Promise<void> {
    if (composeRef.current?.kind === "new") { setMobileDetail(true); return }
    if (blockComposerTransition("starting another message")) return
    if (!await flushComposerBeforeNavigation()) return
    replyDirty.current = false
    editingMessageRef.current = null
    setEditingMessage(null)
    const nextCompose = { kind: "new" as const, subject: newDraft.subject, recipientIds: newDraft.recipientIds }
    composeRef.current = nextCompose
    setCompose(nextCompose)
    replaceReplyBody(newDraft.body)
    setMobileDetail(true)
    setStatus(null)
  }
  useQuickAddEntry("message", () => { void startNewMessage() })
  async function applyState(next: CorrespondenceStateInput): Promise<void> {
    if (activeSummary === null) return
    const result = await setCorrespondenceState(projectId, activeSummary.id, next)
    if (!result.success) {
    setStatus(result.error)
      return
    }
    await refreshInbox()
  }
  async function toggleClosed(): Promise<void> {
    if (activeSummary === null) return
    const result = await setCorrespondenceClosed(
      projectId,
      activeSummary.id,
      !activeSummary.closed,
    )
    setStatus(result.success ? null : result.error)
    if (result.success) await refreshInbox()
  }
  async function setReceiptPreference(share: boolean): Promise<void> {
    if (activeSummary === null) return
    const result = await setCorrespondenceReceiptPreference(projectId, activeSummary.id, share)
    setStatus(result.success ? null : result.error)
    if (result.success) await refreshInbox()
  }
  function updateNewCompose(patch: Partial<Extract<ComposeMode, { readonly kind: "new" }>>): void {
    if (compose?.kind !== "new" || isWorkspaceLocked()) return
    const next: Extract<ComposeMode, { readonly kind: "new" }> = {
      kind: "new",
      subject: patch.subject ?? compose.subject,
      recipientIds: patch.recipientIds ?? compose.recipientIds,
    }
    composeRef.current = next
    setCompose(next)
    newDraftDirty.current = true
    const nextDraft = { ...newDraftRef.current, subject: next.subject, recipientIds: next.recipientIds }
    newDraftRef.current = nextDraft
    setNewDraft(nextDraft)
  }
  function hydrateCompositionDraft(refreshed: CorrespondenceInbox): void {
    const draft = compositionDraft(refreshed)
    compositionVersion.current = draft.version
    newDraftRef.current = draft
    newDraftDirty.current = false
    setNewDraft(draft)
  }
  function isSendLocked(): boolean { return sendInProgress.current || pendingSend.current !== null }
  function isWorkspaceLocked(): boolean { return isSendLocked() || navigationInProgress.current }
  function blockComposerTransition(action: string): boolean {
    const block = composerTransitionBlock({
      busy: isWorkspaceLocked(),
      editing: editingMessageRef.current !== null,
      attachmentCount: stagedAttachments.length,
    })
    if (block === null) return false
    if (block === "editing") setStatus(`Save or cancel the current edit before ${action}.`)
    else if (block === "attachments") setStatus(`Finish or remove staged attachments before ${action}.`)
    else setStatus(`Finish the current operation before ${action}.`)
    return true
  }
  function invalidateDetail(): void {
    detailRequest.current += 1
    detailRef.current = null
    setDetail(null)
    setIsLoadingDetail(true)
  }
  async function flushComposerBeforeNavigation(): Promise<boolean> {
    if (composeRef.current?.kind === "new") {
      if (!newDraftDirty.current) return true
      navigationInProgress.current = true
      setIsNavigating(true)
      const saved = await saveCompositionDraft(newDraftRef.current)
      navigationInProgress.current = false
      setIsNavigating(false)
      return saved
    }
    return flushReplyBeforeNavigation()
  }
  async function flushReplyBeforeNavigation(): Promise<boolean> {
    if (composeRef.current?.kind !== "reply") return true
    if (editingMessageRef.current !== null) return false
    const currentDetail = detailForConversation(detailRef.current, activeId)
    if (currentDetail === null) { setStatus("Wait for this conversation to finish loading."); return false }
    const body = replyBodyRef.current
    if (!replyDirty.current && currentDetail.draft?.body === body) return true
    navigationInProgress.current = true
    setIsNavigating(true)
    const saved = await saveReplyDraft(currentDetail.conversation.id, body)
    navigationInProgress.current = false
    setIsNavigating(false)
    return saved
  }
  function updateReplyBody(body: string): void {
    if (isWorkspaceLocked()) return
    if (editingMessageRef.current === null) replyDirty.current = true
    replaceReplyBody(body)
  }
  function updateNewBody(body: string): void {
    if (isWorkspaceLocked()) return
    newDraftDirty.current = true
    replaceReplyBody(body)
    const nextDraft = { ...newDraftRef.current, body }
    newDraftRef.current = nextDraft
    setNewDraft(nextDraft)
  }
  async function stageFiles(files: FileList | null): Promise<void> {
    if (files === null || isWorkspaceLocked()) return
    const candidates = Array.from(files).map((file) => ({
      localId: crypto.randomUUID(),
      file,
      state: "uploading" as const,
      attachment: null,
    }))
    setStagedAttachments((current) => [...current, ...candidates])
    await Promise.all(candidates.map((candidate) => uploadStagedAttachment(projectId, candidate, setStagedAttachments)))
  }
  async function retryUpload(localId: string): Promise<void> {
    if (isWorkspaceLocked()) return
    const item = stagedAttachments.find((attachment) => attachment.localId === localId)
    if (!item) return
    setStagedAttachments((current) =>
      current.map((attachment) => attachment.localId === localId ? { ...attachment, state: "uploading", attachment: null } : attachment),
    )
    await uploadStagedAttachment(projectId, item, setStagedAttachments)
  }
  function removeStagedAttachment(localId: string): void {
    if (isWorkspaceLocked()) return
    const item = stagedAttachments.find((attachment) => attachment.localId === localId)
    setStagedAttachments((items) => items.filter((attachment) => attachment.localId !== localId))
    if (item?.attachment) {
      const path = `/api/correspondence/attachments/${encodeURIComponent(item.attachment.id)}?projectId=${encodeURIComponent(projectId)}`
      void fetch(path, { method: "DELETE" })
    }
  }
  async function clearStagedAttachments(): Promise<void> {
    const attachments = stagedAttachments.flatMap((item) => item.attachment ? [item.attachment] : [])
    setStagedAttachments([])
    await Promise.all(attachments.map((attachment) => fetch(`/api/correspondence/attachments/${encodeURIComponent(attachment.id)}?projectId=${encodeURIComponent(projectId)}`, { method: "DELETE" })))
  }
  async function send(): Promise<void> {
    if (sendInProgress.current || navigationInProgress.current) return
    let input = pendingSend.current?.input
    let sentNewCompose = false
    if (input === undefined) {
      const currentCompose = composeRef.current
      const newCompose = currentCompose?.kind === "new" ? currentCompose : null
      const currentDetail = detailForConversation(detailRef.current, activeId)
      if (currentCompose?.kind === "reply" && currentDetail === null) { setStatus("Wait for this conversation to finish loading."); return }
      const body = replyBodyRef.current.trim()
      const subject = newCompose?.subject.trim() ?? currentDetail?.conversation.subject ?? ""
      const recipientUserIds = newCompose?.recipientIds ?? currentDetail?.conversation.people.filter((person) => person.userId !== inbox.viewerId).map((person) => person.userId) ?? []
      if (!body || !subject) { setStatus("Add a subject and message before sending."); return }
      if (newCompose !== null && recipientUserIds.length === 0) { setStatus("Choose at least one authorized recipient."); return }
      if (stagedAttachments.some((attachment) => attachment.state !== "ready")) { setStatus("Finish or remove every attachment before sending."); return }
      sendInProgress.current = true
      setIsSending(true)
      const persisted = newCompose !== null
        ? await saveCompositionDraft(newDraftRef.current)
        : currentDetail !== null && (replyDirty.current || currentDetail.draft?.body !== replyBodyRef.current)
          ? await saveReplyDraft(currentDetail.conversation.id, replyBodyRef.current)
          : true
      if (!persisted) {
        sendInProgress.current = false
        setIsSending(false)
        return
      }
      input = {
        projectId, conversationId: newCompose ? null : currentDetail?.conversation.id ?? null, subject, recipientUserIds, body,
        idempotencyKey: crypto.randomUUID(), participantVersion: newCompose ? null : currentDetail?.participantVersion ?? null,
        attachmentIds: stagedAttachments.flatMap((attachment) => attachment.attachment?.id ?? []),
      }
      sentNewCompose = newCompose !== null
      pendingSend.current = { input }
      setHasPendingSend(true)
    } else {
      sendInProgress.current = true
      setIsSending(true)
      sentNewCompose = input.conversationId === null
    }
    if (input === undefined) return
    let result: Awaited<ReturnType<typeof sendCorrespondence>>
    try { result = await sendCorrespondence(input) } catch {
      setStatus("The send result is unknown. Retry to safely resolve the saved message.")
      return
    } finally {
      sendInProgress.current = false
      setIsSending(false)
    }
    if (!result.success) {
      if (result.retry === "edit") {
        pendingSend.current = null
        setHasPendingSend(false)
        setStatus(result.error)
      } else {
        setStatus(`${result.error} Retry uses the same message, recipients, and attachments.`)
      }
      return
    }
    pendingSend.current = null
    setHasPendingSend(false)
    replaceReplyBody("")
    setStagedAttachments([])
    composeRef.current = null
    setCompose(null)
    if (detailRef.current?.conversation.id !== result.data.conversationId) invalidateDetail()
    setActiveId(result.data.conversationId)
    setStatus("Message saved in Compass.")
    replyDirty.current = false
    const refreshedInbox = await refreshInbox()
    if (sentNewCompose && refreshedInbox !== null) hydrateCompositionDraft(refreshedInbox)
    await loadDetail(result.data.conversationId)
  }
  async function discardDraft(): Promise<void> {
    if (isWorkspaceLocked()) return
    navigationInProgress.current = true
    setIsNavigating(true)
    try {
      await replySave.current
      const currentDetail = detailForConversation(detailRef.current, activeId)
      if (currentDetail === null) { setStatus("This conversation is unavailable."); return }
      if (currentDetail.draft !== null) {
        const result = await discardCorrespondenceDraft(projectId, currentDetail.conversation.id, currentDetail.draft.version)
        if (!result.success) { setStatus(result.error); return }
      }
      replaceReplyBody("")
      replyDirty.current = false
      composeRef.current = null
      setCompose(null)
      await clearStagedAttachments()
      setStatus("Draft discarded.")
      await loadDetail(currentDetail.conversation.id)
    } finally {
      navigationInProgress.current = false
      setIsNavigating(false)
      setDiscardDraftOpen(false)
    }
  }
  async function saveRevision(): Promise<void> {
    if (isWorkspaceLocked()) return
    const currentEditingMessage = editingMessageRef.current
    const currentDetail = detailForConversation(detailRef.current, activeId)
    if (currentEditingMessage === null || currentDetail === null) return
    const body = replyBodyRef.current.trim()
    if (!body) {
      setStatus("An edited message cannot be empty. Retract it instead.")
      return
    }
    sendInProgress.current = true
    setIsSending(true)
    try {
      const result = await reviseCorrespondenceMessage(
        projectId,
        currentDetail.conversation.id,
        currentEditingMessage.id,
        body,
      )
      if (!result.success) { setStatus(result.error); return }
      patchRevision(currentDetail.conversation.id, currentEditingMessage.id, body)
      editingMessageRef.current = null
      setEditingMessage(null)
      replyDirty.current = false
      replaceReplyBody(currentDetail.draft?.body ?? "")
      await loadDetail(currentDetail.conversation.id)
    } catch {
      setStatus("The edit could not be saved. Your changes are still here.")
    } finally {
      sendInProgress.current = false
      setIsSending(false)
    }
  }
  async function beginEdit(message: CorrespondenceMessage): Promise<void> {
    if (blockComposerTransition("editing another message")) return
    const currentDetail = detailForConversation(detailRef.current, activeId)
    if (currentDetail === null || !currentDetail.messages.some((current) => current.id === message.id)) {
      setStatus("Wait for this conversation to finish loading.")
      return
    }
    if (!await flushReplyBeforeNavigation()) return
    replyDirty.current = false
    editingMessageRef.current = message
    setEditingMessage(message)
    replaceReplyBody(message.body)
    composeRef.current = { kind: "reply" }
    setCompose({ kind: "reply" })
    setStatus(null)
  }
  function cancelRevision(): void {
    if (isWorkspaceLocked()) return
    const currentDetail = detailForConversation(detailRef.current, activeId)
    editingMessageRef.current = null
    setEditingMessage(null)
    replyDirty.current = false
    replyDraftVersion.current = currentDetail?.draft?.version ?? 0
    replaceReplyBody(currentDetail?.draft?.body ?? "")
    setStatus(null)
  }
  async function retractMessage(): Promise<void> {
    if (isWorkspaceLocked()) return
    if (pendingRetraction === null || detail === null) return
    const result = await reviseCorrespondenceMessage(
      projectId,
      detail.conversation.id,
      pendingRetraction.id,
      null,
    )
    if (result.success) {
      patchRevision(detail.conversation.id, pendingRetraction.id, null)
      await loadDetail(detail.conversation.id)
    }
    else setStatus(result.error)
    setPendingRetraction(null)
  }
  function patchRevision(conversationId: string, messageId: string, body: string | null): void {
    const revisedAt = new Date().toISOString()
    const current = detailRef.current
    if (current?.conversation.id !== conversationId) return
    const next = { ...current, messages: applyMessageRevision(current.messages, messageId, body, revisedAt) }
    detailRef.current = next
    setDetail(next)
  }
  async function discardNewDraft(): Promise<void> {
    if (isWorkspaceLocked()) return
    navigationInProgress.current = true
    setIsNavigating(true)
    try {
      const cleared = await saveCompositionDraft({ subject: "", recipientIds: [], body: "", version: newDraftRef.current.version })
      if (!cleared) return
      newDraftDirty.current = false
      const empty = { ...newDraftRef.current, subject: "", recipientIds: [], body: "", version: compositionVersion.current }
      newDraftRef.current = empty
      setNewDraft(empty)
      replaceReplyBody("")
      composeRef.current = null
      setCompose(null)
      await clearStagedAttachments()
      setMobileDetail(false)
    } finally {
      navigationInProgress.current = false
      setIsNavigating(false)
    }
  }
  async function saveNewDraft(): Promise<void> {
    if (isWorkspaceLocked()) return
    await saveCompositionDraft(newDraftRef.current)
  }
  async function backFromNewCompose(): Promise<void> {
    if (blockComposerTransition("returning to messages")) return
    navigationInProgress.current = true
    setIsNavigating(true)
    try {
      if (newDraftDirty.current && !await saveCompositionDraft(newDraftRef.current)) return
      composeRef.current = null
      setCompose(null)
      setMobileDetail(false)
    } finally {
      navigationInProgress.current = false
      setIsNavigating(false)
    }
  }
  async function backFromConversation(): Promise<void> {
    if (blockComposerTransition("returning to messages")) return
    if (!await flushComposerBeforeNavigation()) return
    composeRef.current = null
    setCompose(null)
    setMobileDetail(false)
    setStatus(null)
  }
  function replaceReplyBody(body: string): void {
    replyBodyRef.current = body
    setReplyBody(body)
  }
  const composingNew = compose?.kind === "new"
  return (
    <section className="flex min-h-0 flex-1 overflow-hidden bg-background" aria-label="Project messages">
      <aside className={cn("flex w-full shrink-0 flex-col border-r md:w-92", mobileDetail && "hidden md:flex")}>
        <div className="border-b p-4">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Project messages</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <h1 className="truncate text-lg font-semibold">{inbox.projectName}</h1>
            <Button size="sm" onClick={startNewMessage}>New message</Button>
          </div>
          <label className="relative mt-4 block">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden="true" />
            <Input className="pl-9" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subjects and messages" aria-label="Search conversations" />
          </label>
          <div className="mt-3 flex gap-1 overflow-x-auto" role="tablist" aria-label="Conversation filters">
            {(["inbox", "unread", "follow-up", "saved", "archived"] as const).map((item) => (
              <Button key={item} type="button" variant={filter === item ? "secondary" : "ghost"} size="sm" onClick={() => setFilter(item)}>
                {filterName(item)}
              </Button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {query.trim().length >= 2 ? <SearchResults hits={searchHits} hasMore={searchHasMore} onOpen={openConversation} /> : visibleConversations.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No conversations match this view.</p>
          ) : visibleConversations.map((conversation) => (
            <button key={conversation.id} type="button" onClick={() => openConversation(conversation.id)} className={cn("w-full border-b px-4 py-3 text-left hover:bg-accent", conversation.id === activeId && "bg-accent")}>
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="truncate">{conversation.people.map((person) => person.name).join(", ")}</span>
                <time dateTime={conversation.lastActivityAt}>{formatTime(conversation.lastActivityAt)}</time>
              </div>
              <div className="mt-1 flex items-center gap-2">
                {conversation.unread && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                <span className="truncate font-medium">{conversation.subject}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{conversation.excerpt}</p>
              <ConversationTags conversation={conversation} />
            </button>
          ))}
        </div>
      </aside>
      <main className={cn("min-w-0 flex-1 overflow-y-auto", !mobileDetail && "hidden md:block")}>
        {composingNew ? (
          <NewMessagePanel
            inbox={inbox}
            compose={compose}
            body={replyBody}
            stagedAttachments={stagedAttachments}
            isSending={isSending || isNavigating}
            hasPendingSend={hasPendingSend || isSending || isNavigating}
            status={status}
            onBack={backFromNewCompose}
            onChange={updateNewCompose}
            onBodyChange={updateNewBody}
            onFiles={stageFiles}
            onRetryUpload={retryUpload}
            onRemoveAttachment={removeStagedAttachment}
            onSend={send}
            onSaveDraft={saveNewDraft}
            onDiscard={discardNewDraft}
          />
        ) : activeSummary === null ? (
          <EmptyDetail />
        ) : (
          <ConversationDetail
            detail={activeDetail}
            activeSummary={activeSummary}
            viewerId={inbox.viewerId}
            workspace={inbox.workspace}
            isLoading={isLoadingDetail}
            body={replyBody}
            compose={compose}
            editingMessage={editingMessage}
            stagedAttachments={stagedAttachments}
            isSending={isSending || isNavigating}
            hasPendingSend={hasPendingSend || isSending || isNavigating}
            status={status}
            targetMessageId={focusMessageId}
            onBack={backFromConversation}
            onCompose={() => {
              if (isWorkspaceLocked()) return
              const currentDetail = detailForConversation(detailRef.current, activeId)
              if (currentDetail === null) { setStatus("Wait for this conversation to finish loading."); return }
              replyDraftVersion.current = currentDetail.draft?.version ?? 0
              composeRef.current = { kind: "reply" }
              setCompose({ kind: "reply" })
              replaceReplyBody(currentDetail.draft?.body ?? "")
              setStatus(null)
            }}
            onBodyChange={updateReplyBody}
            onFiles={stageFiles}
            onRetryUpload={retryUpload}
            onRemoveAttachment={removeStagedAttachment}
            onSend={send}
            onLoadEarlier={() => activeDetail !== null ? loadDetail(activeDetail.conversation.id, undefined, earliestSequence(activeDetail.messages)) : Promise.resolve()}
            onState={applyState}
            onClosed={toggleClosed}
            onReceiptPreference={setReceiptPreference}
            onEdit={beginEdit}
            onSaveRevision={saveRevision}
            onCancelRevision={cancelRevision}
            onRetract={(message) => { if (!isWorkspaceLocked()) setPendingRetraction(message) }}
            onDiscard={() => setDiscardDraftOpen(true)}
            onVisibleMessages={markOpened}
            onTargetHandled={() => setFocusMessageId(undefined)}
          />
        )}
      </main>
      <AlertDialog open={discardDraftOpen} onOpenChange={setDiscardDraftOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Discard this draft?</AlertDialogTitle><AlertDialogDescription>This removes the saved draft for this conversation. It cannot be recovered.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep draft</AlertDialogCancel><AlertDialogAction onClick={discardDraft}>Discard draft</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={pendingRetraction !== null} onOpenChange={(open) => { if (!open) setPendingRetraction(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Retract this message?</AlertDialogTitle><AlertDialogDescription>Recipients may already have seen it. The conversation will show that it was retracted.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={retractMessage}>Retract message</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
function ConversationDetail(props: {
  readonly detail: CorrespondenceDetail | null
  readonly activeSummary: CorrespondenceSummary
  readonly viewerId: string
  readonly workspace: "staff" | "owner" | "sub_vendor"
  readonly isLoading: boolean
  readonly body: string
  readonly compose: ComposeMode | null
  readonly editingMessage: CorrespondenceMessage | null
  readonly stagedAttachments: readonly StagedAttachment[]
  readonly isSending: boolean
  readonly hasPendingSend: boolean
  readonly status: string | null
  readonly targetMessageId?: string
  readonly onBack: () => Promise<void>
  readonly onCompose: () => void
  readonly onBodyChange: (body: string) => void
  readonly onFiles: (files: FileList | null) => Promise<void>
  readonly onRetryUpload: (id: string) => Promise<void>
  readonly onRemoveAttachment: (id: string) => void
  readonly onSend: () => Promise<void>
  readonly onLoadEarlier: () => Promise<void>
  readonly onState: (state: CorrespondenceStateInput) => Promise<void>
  readonly onClosed: () => Promise<void>
  readonly onReceiptPreference: (share: boolean) => Promise<void>
  readonly onEdit: (message: CorrespondenceMessage) => Promise<void>
  readonly onSaveRevision: () => Promise<void>
  readonly onCancelRevision: () => void
  readonly onRetract: (message: CorrespondenceMessage) => void
  readonly onDiscard: () => void
  readonly onVisibleMessages: (conversationId: string, messages: readonly { readonly id: string; readonly editedAt: string | null }[]) => Promise<void>
  readonly onTargetHandled: () => void
}): React.ReactElement {
  const { detail, activeSummary, targetMessageId, onTargetHandled } = props
  const streamRef = React.useRef<HTMLDivElement>(null)
  const onVisibleMessages = props.onVisibleMessages
  React.useEffect(() => {
    if (detail === null || streamRef.current === null) return
    const pending = new Map<string, { readonly id: string; readonly editedAt: string | null }>()
    let timer: number | null = null
    const sendPending = (): void => {
      const messages = [...pending.values()]
      pending.clear()
      timer = null
      if (messages.length > 0) void onVisibleMessages(detail.conversation.id, messages)
    }
    const queue = (id: string, editedAt: string | null): void => {
      pending.set(`${id}:${editedAt ?? ""}`, { id, editedAt })
      if (timer === null) timer = window.setTimeout(sendPending, 150)
    }
    const observer = new IntersectionObserver((entries) => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return
      for (const entry of entries) {
        const id = entry.isIntersecting ? entry.target.getAttribute("data-correspondence-message-id") : null
        if (id !== null) queue(id, entry.target.getAttribute("data-correspondence-message-edited-at"))
      }
    }, { threshold: 0.5 })
    const observe = (): void => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return
      observer.disconnect()
      streamRef.current?.querySelectorAll<HTMLElement>("[data-correspondence-message-id]").forEach((element) => observer.observe(element))
    }
    const reobserve = (): void => observe()
    observe()
    document.addEventListener("visibilitychange", reobserve)
    window.addEventListener("focus", reobserve)
    return () => {
      observer.disconnect()
      document.removeEventListener("visibilitychange", reobserve)
      window.removeEventListener("focus", reobserve)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [detail, onVisibleMessages])
  React.useEffect(() => {
    if (detail === null || targetMessageId === undefined) return
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(`correspondence-message-${targetMessageId}`)
      if (element === null) return
      element.scrollIntoView({ behavior: "smooth", block: "center" })
      element.classList.add("ring-2", "ring-primary")
      window.setTimeout(() => element.classList.remove("ring-2", "ring-primary"), 1600)
      onTargetHandled()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [detail, onTargetHandled, targetMessageId])
  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col">
      <header className="sticky top-0 z-10 border-b bg-background px-4 py-3 md:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Button className="mb-2 md:hidden" variant="ghost" size="sm" disabled={props.hasPendingSend} onClick={() => void props.onBack()}><ArrowLeft />Messages</Button>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Project correspondence</p>
            <h2 className="truncate text-xl font-semibold">{activeSummary.subject}</h2>
          </div>
          <ConversationMenu conversation={activeSummary} workspace={props.workspace} onState={props.onState} onClosed={props.onClosed} onReceiptPreference={props.onReceiptPreference} />
        </div>
        <details className="mt-3 border-t pt-3">
          <summary className="cursor-pointer text-sm font-medium">Visible to {activeSummary.people.map((person) => person.name).join(", ")} <ChevronDown className="inline size-4" /></summary>
          <ul className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            {activeSummary.people.map((person) => <li key={person.userId}>{person.name} · {roleName(person.role)}</li>)}
          </ul>
        </details>
      </header>
      {props.isLoading && detail === null ? <div className="flex flex-1 items-center justify-center"><LoaderCircle className="animate-spin text-muted-foreground" /></div> : detail === null ? <p className="p-6 text-sm text-muted-foreground">This conversation is unavailable.</p> : <>
        <div ref={streamRef} className="flex-1 space-y-5 p-4 md:p-6">
          {detail.hasEarlier && <Button variant="outline" className="mx-auto flex" onClick={() => void props.onLoadEarlier()}>Load earlier messages</Button>}
          {detail.messages.map((message) => <MessageCard key={message.id} projectId={activeSummary.projectId} message={message} viewerId={props.viewerId} editDisabled={props.hasPendingSend || props.editingMessage !== null} onEdit={props.onEdit} onRetract={props.onRetract} />)}
        </div>
        {props.status !== null && <p className="mx-4 border px-3 py-2 text-sm md:mx-6" role="status">{props.status}</p>}
        {props.compose !== null && <>
          {props.editingMessage !== null && <p className="mx-4 border-x border-t px-3 py-2 text-sm text-muted-foreground md:mx-6">Editing your message from {formatDate(props.editingMessage.sentAt)}</p>}
          <Composer body={props.body} stagedAttachments={props.stagedAttachments} isSending={props.isSending} locked={props.hasPendingSend} onBodyChange={props.onBodyChange} onFiles={props.onFiles} onRetryUpload={props.onRetryUpload} onRemoveAttachment={props.onRemoveAttachment} onSend={props.editingMessage === null ? props.onSend : props.onSaveRevision} onDiscard={props.editingMessage === null ? props.onDiscard : props.onCancelRevision} submitLabel={props.editingMessage === null ? "Send" : "Save edit"} />
        </>}
        {props.compose === null && <div className="border-t p-4 md:p-6"><Button onClick={props.onCompose}>Reply</Button></div>}
      </>}
    </div>
  )
}
function filterName(filter: InboxFilter): string { return filter === "follow-up" ? "Needs reply" : filter[0].toUpperCase() + filter.slice(1) }
function roleName(role: CorrespondencePerson["role"]): string { return role === "sub_vendor" ? "Sub/Vendor" : role[0].toUpperCase() + role.slice(1) }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) }
function formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString([], { month: "short", day: "numeric" }) }
function compositionDraft(inbox: CorrespondenceInbox): NewDraft {
  const draft = inbox.compositionDraft
  return draft === null ? { subject: "", body: "", recipientIds: [], version: 0 } : { subject: draft.subject, body: draft.body, recipientIds: draft.recipientUserIds, version: draft.version }
}
function compositionKey(draft: NewDraft): string { return `${draft.subject}\u0000${draft.body}\u0000${draft.recipientIds.join("\u0001")}` }
