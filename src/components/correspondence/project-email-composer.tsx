"use client"

import * as React from "react"
import { ArrowLeft, Check, ChevronDown, LoaderCircle, SendHorizontal, X } from "lucide-react"

import { searchProjectEmailRecipients, sendProjectEmail } from "@/app/actions/project-email"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { isValidRecipientEmail, normalizeRecipientEmail, type EmailRecipientOption } from "@/lib/email/recipient-options"
import { validateProjectEmailAudience } from "@/lib/email/project-email-validation"
import { projectInboundEmailAddress } from "@/lib/email/project-address"

import { useCompositionDraft, type CompositionDraftHandle } from "./use-composition-draft"
import type { CompositionContent, SavedComposition } from "@/lib/correspondence/types"
import { ProjectEmailAttachments } from "./project-email-attachments"
import type { StagedAttachment } from "./correspondence-workspace-utils"
import { MAX_PROJECT_EMAIL_ATTACHMENT_BYTES } from "@/lib/correspondence/attachment-limits"

type AudienceKind = "to" | "cc" | "bcc"
type Audience = Readonly<Record<AudienceKind, readonly string[]>>

export function ProjectEmailComposer(props: {
  readonly ref: React.Ref<CompositionDraftHandle>
  readonly initialDraft: SavedComposition | null
  readonly onDraftSaved: () => void
  readonly projectId: string
  readonly onBack: () => void
  readonly onBusyChange: (busy: boolean) => void
  readonly onSent: (conversationId: string, status: "sent" | "failed" | "unknown", message: string | null) => Promise<void>
}): React.ReactElement {
  const initial = props.initialDraft?.content.kind === "email" ? props.initialDraft.content : null
  const [files, setFiles] = React.useState<readonly StagedAttachment[]>(() => props.initialDraft?.attachments.map((file) => ({ localId: file.id, file: null, state: file.available ? "ready" : "failed", attachment: file })) ?? [])
  const [attachmentBusy, setAttachmentBusy] = React.useState(false)
  const [audience, setAudience] = React.useState<Audience>({ to: initial?.to ?? [], cc: initial?.cc ?? [], bcc: initial?.bcc ?? [] })
  const [projectOptions, setProjectOptions] = React.useState<readonly EmailRecipientOption[]>([])
  const [subject, setSubject] = React.useState(initial?.subject ?? "")
  const [body, setBody] = React.useState(initial?.body ?? "")
  const [status, setStatus] = React.useState<string | null>(null)
  const [sending, setSending] = React.useState(false)
  const [frozen, setFrozen] = React.useState(Boolean(initial?.requestId))
  const [uncertain, setUncertain] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [reservedRequestId, setReservedRequestId] = React.useState(initial?.requestId ?? null)
  const [discardOpen, setDiscardOpen] = React.useState(false)
  const [discarded, setDiscarded] = React.useState(false)
  const requestId = React.useRef<string | null>(initial?.requestId ?? null)
  const sendingRef = React.useRef(false)
  const content: CompositionContent = { kind: "email", subject, body, ...audience, attachmentIds: files.flatMap((file) => file.attachment ? [file.attachment.id] : []), requestId: reservedRequestId }
  const draft = useCompositionDraft({ projectId: props.projectId, initial: props.initialDraft, content, busy: sending || attachmentBusy || files.some((file) => file.state !== "ready"), onStatus: setStatus, onSaved: props.onDraftSaved })
  React.useImperativeHandle(props.ref, () => ({ flush: draft.flush }), [draft.flush])
  async function back(): Promise<void> { if (await draft.flush()) props.onBack() }
  async function discard(): Promise<void> { if (await draft.discard()) { setDiscarded(true); setDiscardOpen(false) } }

  React.useEffect(() => {
    let active = true
    void searchProjectEmailRecipients(props.projectId, "project", "").then((result) => {
      if (!active) return
      if (result.success) setProjectOptions(result.data)
      else setStatus(result.error)
    }).catch(() => { if (active) setStatus("Project contacts could not be loaded. You can still enter addresses manually.") })
    return () => { active = false }
  }, [props.projectId])

  function changeAudience(kind: AudienceKind, emails: readonly string[]): void {
    if (frozen) return
    setAudience((current) => ({ ...current, [kind]: emails }))
    setStatus(null)
  }

  async function send(): Promise<void> {
    if (sendingRef.current || attachmentBusy || files.some((file) => file.state !== "ready") || files.reduce((n, file) => n + (file.attachment?.size ?? 0), 0) > MAX_PROJECT_EMAIL_ATTACHMENT_BYTES) return
    const validated = validateProjectEmailAudience(audience)
    if (!validated.success) { setStatus(validated.error); return }
    if (!subject.trim() || subject.trim().length > 200 || !body.trim() || body.length > 50000) {
      setStatus("Enter a subject and message of at most 50,000 characters.")
      return
    }
    sendingRef.current = true
    setSending(true)
    props.onBusyChange(true)
    setFrozen(true)
    setConfirmOpen(false)
    requestId.current ??= crypto.randomUUID().replace(/-/g, "")
    setReservedRequestId(requestId.current)
    try {
      const saved = await draft.save({ ...content, requestId: requestId.current })
      if (!saved) return
      const result = await sendProjectEmail({ draft: { id: saved.id, version: saved.version }, projectId: props.projectId, subject, body, attachmentIds: files.flatMap((file) => file.attachment ? [file.attachment.id] : []), ...validated.data, requestId: requestId.current })
      if (!result.success) {
        if (result.draftVersion !== undefined) {
          draft.acceptSaved({ ...content, requestId: null }, result.draftVersion)
          requestId.current = null
          setReservedRequestId(null)
          setFrozen(false)
          setUncertain(false)
          props.onDraftSaved()
          setStatus(`${result.error} Review this draft before sending again.`)
        } else setStatus(`${result.error} Retry keeps the same recipients and message.`)
        return
      }
      draft.stop()
      await props.onSent(result.conversationId, result.status, result.error)
    } catch {
      setStatus("The delivery outcome is unknown. Check project messages before attempting another send.")
      setUncertain(true)
    } finally {
      sendingRef.current = false
      setSending(false)
      props.onBusyChange(false)
    }
  }

  const recipientCount = audience.to.length + audience.cc.length + audience.bcc.length
  const canEdit = !sending && !frozen && !attachmentBusy
  const attachmentsReady = !attachmentBusy && files.every((file) => file.state === "ready") && files.reduce((n, file) => n + (file.attachment?.size ?? 0), 0) <= MAX_PROJECT_EMAIL_ATTACHMENT_BYTES
  if (discarded) return <div className="mx-auto max-w-3xl p-6"><p>Draft discarded.</p><div className="mt-3 flex gap-2"><Button variant="outline" onClick={() => void draft.restore().then((restored) => { if (restored) setDiscarded(false) })}>Undo discard</Button><Button variant="ghost" onClick={props.onBack}>Back to messages</Button></div></div>
  return (
    <div className="mx-auto min-h-full max-w-3xl p-4 md:p-6">
      <Button variant="ghost" size="sm" disabled={sending || attachmentBusy} onClick={() => void back()}><ArrowLeft />Back to messages</Button>
      <h2 className="mt-4 text-xl font-semibold">New project email</h2>
      <p className="mt-1 text-sm text-muted-foreground">Send to project contacts, people in the directory, or any valid email address. The message is saved in Compass, and replies return to this project conversation. Recipients with active Compass access to this project can also read and reply here. Other recipients use email.</p>
      <div className="mt-6 grid gap-5">
        {(["to", "cc", "bcc"] as const).map((kind) => (
          <ProjectEmailAddressPicker
            key={kind}
            projectId={props.projectId}
            label={kind === "to" ? "To" : kind === "cc" ? "Cc" : "Bcc"}
            kind={kind}
            value={audience[kind]}
            excluded={kind === "to" ? [...audience.cc, ...audience.bcc] : kind === "cc" ? [...audience.to, ...audience.bcc] : [...audience.to, ...audience.cc]}
            projectOptions={projectOptions}
            disabled={!canEdit}
            onChange={(emails) => changeAudience(kind, emails)}
          />
        ))}
        <p className="text-xs text-muted-foreground">To and Cc addresses are visible to email recipients. Bcc recipients have a private Compass view; their addresses and replies are hidden from other external recipients.</p>
        <p className="break-all text-xs text-muted-foreground">Project email: {projectInboundEmailAddress(props.projectId)}. Replies to this email return to this conversation.</p>
        <label className="grid gap-2 text-sm font-medium">Subject
          <Input value={subject} maxLength={200} disabled={!canEdit} onChange={(event) => { setSubject(event.target.value); setStatus(null) }} placeholder="What is this project update about?" />
        </label>
        <label className="grid gap-2 text-sm font-medium">Message
          <Textarea value={body} maxLength={50000} disabled={!canEdit} onChange={(event) => { setBody(event.target.value); setStatus(null) }} rows={9} placeholder="Write your message…" />
        </label>
        <ProjectEmailAttachments projectId={props.projectId} files={files} onChange={setFiles} locked={sending || frozen} onError={setStatus} onBusyChange={(busy) => { setAttachmentBusy(busy); props.onBusyChange(busy) }} />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <span className="text-sm text-muted-foreground">{recipientCount} {recipientCount === 1 ? "recipient" : "recipients"} · maximum 50</span>
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!canEdit || !attachmentsReady} onClick={() => void draft.save()}>Save draft</Button><Button variant="ghost" disabled={sending || attachmentBusy} onClick={() => setDiscardOpen(true)}>Discard draft</Button>
          <Button disabled={sending || uncertain || !attachmentsReady || recipientCount === 0 || !subject.trim() || !body.trim()} onClick={() => setConfirmOpen(true)}>
            {sending ? <LoaderCircle className="animate-spin" /> : <SendHorizontal />}{frozen ? "Retry same email" : "Review and send"}
          </Button></div>
        </div>
        {status && <p className="border px-3 py-2 text-sm" role="status">{status}</p>}
      </div>
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard this email draft?</AlertDialogTitle><AlertDialogDescription>The draft will be removed from Drafts. You can undo this before leaving this page. No email will be sent.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep draft</AlertDialogCancel><AlertDialogAction onClick={() => void discard()}>Discard draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Send this project email?</AlertDialogTitle><AlertDialogDescription>Compass will email {recipientCount} {recipientCount === 1 ? "recipient" : "recipients"} ({audience.to.length} To, {audience.cc.length} Cc, {audience.bcc.length} Bcc) with {files.length} {files.length === 1 ? "attachment" : "attachments"} and save the message in project history. Active project users can also see it in Compass. Bcc recipients remain hidden and their replies are private to project staff. No new account or project access is created.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void send()}>Send email</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ProjectEmailAddressPicker(props: {
  readonly projectId: string
  readonly label: string
  readonly kind: AudienceKind
  readonly value: readonly string[]
  readonly excluded: readonly string[]
  readonly projectOptions: readonly EmailRecipientOption[]
  readonly disabled: boolean
  readonly onChange: (emails: readonly string[]) => void
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [searchedProjectOptions, setSearchedProjectOptions] = React.useState<readonly EmailRecipientOption[]>([])
  const [directoryOptions, setDirectoryOptions] = React.useState<readonly EmailRecipientOption[]>([])
  const [searching, setSearching] = React.useState(false)
  const [searchError, setSearchError] = React.useState(false)
  const id = React.useId()
  React.useEffect(() => {
    const term = query.trim()
    if (!open || term.length < 2) { setSearchedProjectOptions([]); setDirectoryOptions([]); setSearching(false); setSearchError(false); return }
    let active = true
    const timer = window.setTimeout(() => {
      setSearching(true)
      void Promise.all([
        searchProjectEmailRecipients(props.projectId, "project", term),
        searchProjectEmailRecipients(props.projectId, "directory", term),
      ]).then(([projectResult, directoryResult]) => {
        if (!active) return
        setSearchedProjectOptions(projectResult.success ? projectResult.data : [])
        setDirectoryOptions(directoryResult.success ? directoryResult.data : [])
        setSearchError(!projectResult.success || !directoryResult.success)
        setSearching(false)
      }).catch(() => { if (active) { setSearchedProjectOptions([]); setDirectoryOptions([]); setSearchError(true); setSearching(false) } })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [open, props.projectId, query])

  const excluded = new Set(props.excluded.map(normalizeRecipientEmail))
  const selected = new Set(props.value.map(normalizeRecipientEmail))
  const matches = (option: EmailRecipientOption): boolean => `${option.displayName} ${option.companyName ?? ""} ${option.email}`.toLowerCase().includes(query.trim().toLowerCase())
  const project = (query.trim().length >= 2 ? searchedProjectOptions : props.projectOptions).filter((option) => !excluded.has(option.email) && matches(option))
  const projectEmails = new Set(project.map((option) => option.email))
  const directory = directoryOptions.filter((option) => !excluded.has(option.email) && !projectEmails.has(option.email) && matches(option))
  const manual = normalizeRecipientEmail(query)
  const canAddManual = isValidRecipientEmail(manual) && !selected.has(manual) && !excluded.has(manual)
  const names = new Map([...props.projectOptions, ...searchedProjectOptions, ...directoryOptions].map((option) => [option.email, option.displayName]))

  function toggle(email: string): void {
    if (props.disabled) return
    const normalized = normalizeRecipientEmail(email)
    props.onChange(selected.has(normalized) ? props.value.filter((value) => normalizeRecipientEmail(value) !== normalized) : [...props.value, normalized])
    setQuery("")
  }
  function optionRow(option: EmailRecipientOption): React.ReactElement {
    return <CommandItem key={option.email} value={`${option.id}:${option.email}`} onSelect={() => toggle(option.email)}><Check className={`size-4 ${selected.has(option.email) ? "opacity-100" : "opacity-0"}`} /><span className="min-w-0"><span className="block truncate text-sm font-medium">{option.displayName}</span><span className="block truncate text-xs text-muted-foreground">{option.companyName ? `${option.companyName} · ` : ""}{option.email}</span></span></CommandItem>
  }
  return <div className="grid gap-2">
    <Label htmlFor={id}>{props.label}{props.kind === "to" && <span aria-hidden="true"> *</span>}</Label>
    <div className="rounded-md border bg-background p-2">
      {props.value.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">{props.value.map((email) => <span key={email} className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs"><span className="max-w-52 truncate">{names.get(email) ?? email}</span><button type="button" disabled={props.disabled} aria-label={`Remove ${email}`} onClick={() => toggle(email)} className="text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button></span>)}</div>}
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery("") }}>
        <PopoverTrigger asChild><Button id={id} type="button" role="combobox" aria-expanded={open} disabled={props.disabled} variant="ghost" className="h-8 w-full justify-between px-2 font-normal"><span className="truncate text-muted-foreground">{props.value.length ? "Add another recipient" : `Choose ${props.label} recipients`}</span><ChevronDown className="size-4" /></Button></PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0 sm:min-w-96">
          <Command shouldFilter={false}><CommandInput value={query} onValueChange={setQuery} placeholder="Search project or directory, or type an email" /><CommandList>
            {canAddManual && <CommandGroup heading="New email address"><CommandItem value={`add:${manual}`} onSelect={() => toggle(manual)}>Add {manual}</CommandItem></CommandGroup>}
            {project.length > 0 && <CommandGroup heading="Active project contacts">{project.map(optionRow)}</CommandGroup>}
            {directory.length > 0 && <CommandGroup heading="Directory: owners, vendors, internal">{directory.map(optionRow)}</CommandGroup>}
            {searching && <p className="px-3 py-2 text-xs text-muted-foreground">Searching directory…</p>}
            {searchError && <p className="px-3 py-2 text-xs text-destructive">Directory search is unavailable. Enter an email address directly.</p>}
            {!canAddManual && !project.length && !directory.length && !searching && !searchError && <CommandEmpty>{query.length < 2 ? "Type at least two characters to search the directory." : "No matching contacts. Enter a complete email address to add one."}</CommandEmpty>}
          </CommandList></Command>
        </PopoverContent>
      </Popover>
    </div>
  </div>
}
