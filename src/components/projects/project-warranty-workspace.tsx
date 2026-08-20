"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  IconCalendarEvent,
  IconCheck,
  IconDownload,
  IconHistory,
  IconPaperclip,
  IconPlus,
  IconShieldCheck,
  IconTrash,
} from "@tabler/icons-react"

import {
  confirmProjectWarrantyResolution,
  createProjectWarrantyClaim,
  deleteProjectWarrantyClaim,
  updateProjectWarrantyClaim,
  type WarrantyClaimItem,
  type WarrantyWorkspace,
} from "@/app/actions/project-warranty"
import { SearchableComboboxField } from "@/components/searchable-combobox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import {
  WARRANTY_CLAIM_PRIORITIES,
  WARRANTY_CLAIM_STATUSES,
} from "@/lib/warranty/status"

const CATEGORIES = [
  "Exterior",
  "Interior",
  "Electrical",
  "Plumbing",
  "HVAC",
  "Appliance",
  "Finish",
  "Site / drainage",
  "Other",
] as const

function formText(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}

function optionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function label(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

const CATEGORY_OPTIONS = CATEGORIES.map((category) => ({
  value: category,
  label: category,
}))

const PRIORITY_OPTIONS = WARRANTY_CLAIM_PRIORITIES.map((priority) => ({
  value: priority,
  label: label(priority),
}))

const STATUS_OPTIONS = WARRANTY_CLAIM_STATUSES.map((status) => ({
  value: status,
  label: label(status),
}))

function formatDate(value: string | null): string {
  if (!value) return "Not scheduled"
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function ClaimCreateSheet({
  projectId,
  viewerIsInternal,
}: {
  readonly projectId: string
  readonly viewerIsInternal: boolean
}): React.ReactElement {
  const router = useRouter()
  const formRef = React.useRef<HTMLFormElement>(null)
  const [open, setOpen] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [files, setFiles] = React.useState<readonly File[]>([])

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault()
    const form = formRef.current
    if (!form) return
    setSubmitting(true)
    setMessage(null)
    try {
      const data = new FormData(form)
      const result = await createProjectWarrantyClaim(projectId, {
        title: formText(data, "title"),
        location: optionalText(formText(data, "location")),
        category: formText(data, "category"),
        description: formText(data, "description"),
        priority: formText(data, "priority"),
        claimantName: optionalText(formText(data, "claimantName")),
      })
      if (!result.success) throw new Error(result.error)

      if (files.length > 0) {
        const uploadData = new FormData()
        for (const file of files) uploadData.append("files", file)
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/warranty/${encodeURIComponent(result.id)}/attachments`,
          { method: "POST", body: uploadData }
        )
        const uploadResult: unknown = await response.json()
        if (
          !response.ok ||
          typeof uploadResult !== "object" ||
          uploadResult === null ||
          Reflect.get(uploadResult, "success") !== true
        ) {
          const error =
            typeof uploadResult === "object" &&
            uploadResult !== null &&
            typeof Reflect.get(uploadResult, "error") === "string"
              ? Reflect.get(uploadResult, "error")
              : "Evidence upload failed."
          throw new Error(
            `The claim was saved, but its evidence did not upload: ${error}`
          )
        }
      }

      form.reset()
      setFiles([])
      setOpen(false)
      router.refresh()
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to submit warranty claim."
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button>
          <IconPlus className="size-4" />
          New warranty claim
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[min(96vw,720px)] overflow-y-auto sm:max-w-none">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>New warranty claim</SheetTitle>
          <SheetDescription>
            Record the location, issue, urgency, and supporting photos, video,
            or documents.
          </SheetDescription>
        </SheetHeader>
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4 px-5 pb-6">
          <Input name="title" placeholder="Short issue title" required />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input name="location" placeholder="Location (room or area)" />
            <SearchableComboboxField
              name="category"
              ariaLabel="Warranty category"
              options={CATEGORY_OPTIONS}
              placeholder="Choose category"
              searchPlaceholder="Type a warranty category..."
              emptyMessage="No matching warranty categories."
              groupHeading="Categories"
              defaultValue=""
              required
              className="h-9"
            />
          </div>
          <Textarea
            name="description"
            placeholder="Describe what is happening and when you first noticed it"
            className="min-h-32"
            required
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <SearchableComboboxField
              name="priority"
              ariaLabel="Warranty priority"
              options={PRIORITY_OPTIONS}
              placeholder="Choose priority"
              searchPlaceholder="Type a priority..."
              emptyMessage="No matching priorities."
              groupHeading="Priorities"
              defaultValue="normal"
              className="h-9"
            />
            {viewerIsInternal && (
              <Input name="claimantName" placeholder="Owner / claimant name" />
            )}
          </div>
          <div className="border-t pt-4">
            <label className="flex items-start gap-2 text-sm font-medium">
              <IconPaperclip className="mt-0.5 size-4" />
              <span>
                Evidence files
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  Images, video, PDFs, and documents; 50 MB each and 90 MB per batch.
                </span>
              </span>
            </label>
            <Input
              type="file"
              multiple
              accept="image/*,video/*,.pdf,.doc,.docx,.txt"
              className="mt-3"
              onChange={(event) =>
                setFiles(event.currentTarget.files ? Array.from(event.currentTarget.files) : [])
              }
            />
            {files.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {files.length} {files.length === 1 ? "file" : "files"} selected
              </p>
            )}
          </div>
          {message && (
            <p role="alert" className="border-l-2 border-destructive px-3 text-sm text-destructive">
              {message}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit claim"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function ClaimActions({
  projectId,
  claim,
  viewerIsInternal,
  assigneeNames,
}: {
  readonly projectId: string
  readonly claim: WarrantyClaimItem
  readonly viewerIsInternal: boolean
  readonly assigneeNames: readonly string[]
}): React.ReactElement {
  const router = useRouter()
  const [message, setMessage] = React.useState<string | null>(null)
  const [submitting, startTransition] = React.useTransition()

  function handleUpdate(formData: FormData): void {
    startTransition(async () => {
      const assignedName = optionalText(formText(formData, "assignedName"))
      const result = await updateProjectWarrantyClaim(projectId, claim.id, {
        status: formText(formData, "status"),
        priority: formText(formData, "priority"),
        assignedUserId: null,
        assignedName,
        scheduledFor: optionalText(formText(formData, "scheduledFor")),
        resolutionSummary: optionalText(formText(formData, "resolutionSummary")),
        internalNotes: optionalText(formText(formData, "internalNotes")),
      })
      setMessage(result.success ? "Claim updated." : result.error)
      if (result.success) router.refresh()
    })
  }

  function handleConfirm(): void {
    startTransition(async () => {
      const result = await confirmProjectWarrantyResolution(projectId, claim.id)
      setMessage(result.success ? "Resolution confirmed." : result.error)
      if (result.success) router.refresh()
    })
  }

  function handleDelete(): void {
    if (!window.confirm(`Delete ${claim.claimNumber}? This cannot be undone.`)) return
    startTransition(async () => {
      const result = await deleteProjectWarrantyClaim(projectId, claim.id)
      setMessage(result.success ? "Claim deleted." : result.error)
      if (result.success) router.refresh()
    })
  }

  if (viewerIsInternal) {
    return (
      <form action={handleUpdate} className="mt-4 space-y-3 border-t pt-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Status
            <SearchableComboboxField
              name="status"
              defaultValue={claim.status}
              ariaLabel={`Status for ${claim.claimNumber}`}
              options={STATUS_OPTIONS}
              placeholder="Choose status"
              searchPlaceholder="Type a claim status..."
              emptyMessage="No matching statuses."
              groupHeading="Statuses"
              className="h-9 text-foreground"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Priority
            <SearchableComboboxField
              name="priority"
              defaultValue={claim.priority}
              ariaLabel={`Priority for ${claim.claimNumber}`}
              options={PRIORITY_OPTIONS}
              placeholder="Choose priority"
              searchPlaceholder="Type a priority..."
              emptyMessage="No matching priorities."
              groupHeading="Priorities"
              className="h-9 text-foreground"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Assigned to
            <SearchableComboboxField
              name="assignedName"
              defaultValue={claim.assignedName ?? ""}
              ariaLabel={`Assign ${claim.claimNumber}`}
              options={[
                { value: "", label: "Unassigned" },
                ...assigneeNames.map((name) => ({ value: name, label: name })),
              ]}
              placeholder="Unassigned"
              searchPlaceholder="Type an assignee name..."
              emptyMessage="No matching assignees."
              groupHeading="Assignees"
              className="h-9 text-foreground"
            />
          </label>
        </div>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          Visit / work date
          <Input name="scheduledFor" type="datetime-local" defaultValue={claim.scheduledFor?.slice(0, 16) ?? ""} className="text-foreground" />
        </label>
        <Textarea name="resolutionSummary" defaultValue={claim.resolutionSummary ?? ""} placeholder="Owner-visible resolution or progress note" />
        <Textarea name="internalNotes" defaultValue={claim.internalNotes ?? ""} placeholder="Internal notes (never shown to owners)" />
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {claim.viewerCanDelete && (
            <Button type="button" variant="outline" onClick={handleDelete} disabled={submitting}>
              <IconTrash className="size-4" /> Delete
            </Button>
          )}
          <Button type="submit" disabled={submitting}>{submitting ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    )
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t pt-4">
      {message && <p className="mr-auto text-xs text-muted-foreground">{message}</p>}
      {claim.status === "resolved" && (
        <Button onClick={handleConfirm} disabled={submitting}>
          <IconCheck className="size-4" /> Confirm resolution
        </Button>
      )}
      {claim.viewerCanDelete && (
        <Button variant="outline" onClick={handleDelete} disabled={submitting}>
          <IconTrash className="size-4" /> Withdraw claim
        </Button>
      )}
    </div>
  )
}

function ClaimRow({
  projectId,
  claim,
  viewerIsInternal,
  assigneeNames,
}: {
  readonly projectId: string
  readonly claim: WarrantyClaimItem
  readonly viewerIsInternal: boolean
  readonly assigneeNames: readonly string[]
}): React.ReactElement {
  return (
    <article id={`warranty-${claim.id}`} className="border-b py-5 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{claim.claimNumber}</p>
          <h2 className="mt-1 text-lg font-semibold">{claim.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {[claim.location, claim.category, `Submitted by ${claim.claimantName}`].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant={claim.priority === "urgent" || claim.priority === "high" ? "destructive" : "outline"}>{label(claim.priority)}</Badge>
          <Badge variant={claim.status === "closed" ? "outline" : "secondary"}>{label(claim.status)}</Badge>
        </div>
      </div>
      <p className="mt-4 whitespace-pre-wrap text-sm leading-6">{claim.description}</p>
      <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <p><IconCalendarEvent className="mr-1 inline size-4" />Visit: {formatDate(claim.scheduledFor)}</p>
        <p>Assigned: {claim.assignedName ?? "Not assigned"}</p>
        <p>Updated: {formatDate(claim.updatedAt)}</p>
      </div>
      {claim.resolutionSummary && (
        <div className="mt-4 border-l-2 border-primary pl-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">Resolution / progress</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{claim.resolutionSummary}</p>
        </div>
      )}
      {claim.attachments.length > 0 && (
        <div className="mt-4">
          <p className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground"><IconPaperclip className="size-4" />Evidence</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {claim.attachments.map((attachment) => (
              <Button key={attachment.id} asChild variant="outline" size="sm">
                <Link href={attachment.downloadHref} target="_blank">
                  <IconDownload className="size-4" />{attachment.fileName}
                </Link>
              </Button>
            ))}
          </div>
        </div>
      )}
      {claim.events.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground"><IconHistory className="size-4" />Activity history ({claim.events.length})</summary>
          <ol className="mt-3 space-y-2 border-l pl-4">
            {claim.events.map((event) => (
              <li key={event.id}>
                <p className="text-xs">{label(event.eventType)} · {event.actorName} · {formatDate(event.createdAt)}</p>
                {event.note && <p className="mt-1 text-xs text-muted-foreground">{event.note}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
      <ClaimActions projectId={projectId} claim={claim} viewerIsInternal={viewerIsInternal} assigneeNames={assigneeNames} />
    </article>
  )
}

export function ProjectWarrantyWorkspace({
  workspace,
  assigneeNames = [],
}: {
  readonly workspace: WarrantyWorkspace
  readonly assigneeNames?: readonly string[]
}): React.ReactElement {
  return (
    <section className="bg-background">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b px-4 py-5 sm:px-6">
        <div>
          <div className="flex items-center gap-2">
            <IconShieldCheck className="size-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold">Warranty claims</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Submit issues, attach evidence, schedule visits, and track resolution.
          </p>
        </div>
        <ClaimCreateSheet projectId={workspace.project.id} viewerIsInternal={workspace.viewerIsInternal} />
      </div>
      {!workspace.project.warrantyEnabled && workspace.viewerIsInternal && (
        <p className="border-b bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50 sm:px-6">
          Staff can prepare claims, but the owner workspace remains hidden until this project enters Warranty or Service status.
        </p>
      )}
      <div className="px-4 sm:px-6">
        {workspace.claims.length > 0 ? (
          workspace.claims.map((claim) => (
            <ClaimRow key={claim.id} projectId={workspace.project.id} claim={claim} viewerIsInternal={workspace.viewerIsInternal} assigneeNames={assigneeNames} />
          ))
        ) : (
          <div className="py-16 text-center">
            <IconShieldCheck className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 font-medium">No warranty claims yet</p>
            <p className="mt-1 text-sm text-muted-foreground">New submissions will appear here with their complete history.</p>
          </div>
        )}
      </div>
    </section>
  )
}
